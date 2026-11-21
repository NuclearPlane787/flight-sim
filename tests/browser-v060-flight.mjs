// v0.6.0 Part 4: a flight between the region's airports, end to end, in Chrome on the Mac's GPU
// (headless: Shane's rule until 01:30), with the region on (?eastasia=1):
//   take-off from the origin's runway (the test pilot) -> the autopilot on a heading down the route
//   (the script turns the HDG bug towards the destination as a pilot would), climbing to the
//   cruise level -> 16x time compression, the frame times logged while the tiles load -> the path
//   map and a jump to about 60 nm out -> skip to final -> the test pilot's landing -> the score.
// Legs run one after another in the same page (the second from __fs.startFlight), so the heap and
// the GPU's memory after the first leg and after the last can be compared (the leak check).
//
// From GameDump, through the guard (a leg of 640 nm takes about 6 minutes):
//   python3 games/flight-sim/tools/cpu-guard.py --minutes 18 -- node games/flight-sim/tests/browser-v060-flight.mjs \
//     RKSS:14R-RJTT:34L [RJTT:16L-RKSS:14R ...] [--type b787-9] [--fl 350] [--tag gimpo-haneda] [--no-jump] [--whole] [--final]
// --no-land: each leg ends on the final after the skip (no landing): the leak check's legs.
// --final: each leg starts on its 15 nm final at the destination (the route picked, the flight not flown).
// --whole: no skip to final; the jump lands 60 nm out and the script descends on the autopilot,
// then the test pilot flies the approach from about 12 nm.
// Env: E2E_ROOT (default http://127.0.0.1:8014/).
import { chromium } from '/tmp/flight-sim/pw/node_modules/playwright/index.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, '../../../Claude outputs/flight-sim');
const ROOT = process.env.E2E_ROOT || 'http://127.0.0.1:8014/';
const FT = 3.28084, KT = 1.943844, NM = 1852;
const argv = process.argv.slice(2);
const opt = { legs: [], type: null, fl: 350, tag: null, jump: true, whole: false, rate: 16 };
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--type') opt.type = argv[++i];
  else if (argv[i] === '--fl') opt.fl = Number(argv[++i]);
  else if (argv[i] === '--tag') opt.tag = argv[++i];
  else if (argv[i] === '--no-jump') opt.jump = false;
  else if (argv[i] === '--whole') opt.whole = true;
  else if (argv[i] === '--final') opt.final = true;
  else if (argv[i] === '--no-land') opt.noLand = true;
  else if (argv[i] === '--ground') opt.ground = true;      // Part 7's ground on (?ground=1)
  else if (argv[i] === '--rate') opt.rate = Number(argv[++i]);
  else {
    const m = /^(\w{4}):(\w+)-(\w{4}):(\w+)$/.exec(argv[i]);
    if (!m) { console.error('a leg is ORIG:RWY-DEST:RWY, e.g. RKSS:14R-RJTT:34L'); process.exit(2); }
    opt.legs.push({ origin: m[1], dep: m[2], dest: m[3], arr: m[4] });
  }
}
if (!opt.legs.length) opt.legs.push({ origin: 'RKSS', dep: '14R', dest: 'RJTT', arr: '34L' });
const tag = opt.tag || `${opt.legs[0].origin}-${opt.legs[0].dest}`.toLowerCase();

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); };

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required', '--enable-precise-memory-info', '--js-flags=--expose-gc'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  globalThis.__page = page;   // (for the exception's report below)
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  const L0 = opt.legs[0];
  const fuelFor = (nm) => Math.round(Math.min(opt.type ? 60000 : 17500, (opt.type ? 9000 : 3500) + nm * (opt.type ? 16 : 7.5)));
  await page.goto(`${ROOT}games/flight-sim/?test&eastasia=1${opt.ground ? '&ground=1' : ''}&origin=${L0.origin}&dep=${L0.dep}&dest=${L0.dest}&arr=${L0.arr}&start=${opt.final ? 'final' : 'runway'}&fuel=${opt.final ? 6000 : 17000}${opt.type ? `&type=${opt.type}` : ''}${process.env.E2E_EXTRA || ''}`);   // (v0.7.0: E2E_EXTRA, '&region=europe' or '&pending=1')
  await page.waitForFunction(() => window.__fs && window.__fs.sim && window.__fs.frames > 10, null, { timeout: 90000 });
  await page.addScriptTag({ content: readFileSync(path.join(here, 'e2e-controller.js'), 'utf8') });
  const gl = await page.evaluate(() => { const c = document.createElement('canvas').getContext('webgl2'); const e = c.getExtension('WEBGL_debug_renderer_info'); return c.getParameter(e.UNMASKED_RENDERER_WEBGL); });
  console.log('renderer:', gl, '(headless)');
  // The frame-time probe: every frame's interval, with the sim's time scale then.
  await page.evaluate(() => {
    const p = window.__probe = { on: false, dts: [], last: 0, worst: 0, worstAt: null, long: [], prev: null, marks: [], tasks: [] };
    // v0.7.1: why the autopilot went off, if it did (the reason and the state then), for a failed leg's report.
    p.apOff = [];
    { const ap = window.__fs.ap, off = ap.disconnectAp.bind(ap);
      ap.disconnectAp = (reason) => { if (ap.ap) { const s = window.__fs.sim.state; p.apOff.push({ reason, t: +s.t.toFixed(1), iasKt: Math.round(s.ias * 1.943844), altFt: Math.round(s.pos.z * 3.28084), vls: s.vls ? Math.round(s.vls * 1.943844) : null, flaps: window.__fs.sim.controls ? window.__fs.sim.controls.flaps : null }); } return off(reason); }; }
    // v0.7.1 (E2E_MARKS=1, the page's ?marks): what ran in a long frame. The world's parts and the renderer are timed from
    // outside (calls over 1.5 ms kept, the last 400), with the browser's own long tasks; a long frame lists those inside it.
    if (/[?&]marks/.test(location.search)) {
      p.marksOn = true;
      const fs = window.__fs, w = fs.world;
      const wrap = (obj, fn, name) => {
        if (!obj || typeof obj[fn] !== 'function') return;
        const g = obj[fn].bind(obj);
        obj[fn] = (...a) => { const t = performance.now(); const r = g(...a); const ms = performance.now() - t; if (ms > 1.5) { p.marks.push({ name, t, ms: +ms.toFixed(1) }); if (p.marks.length > 400) p.marks.shift(); } return r; };
      };
      for (const k of Object.keys(w)) if (w[k] && typeof w[k] === 'object' && typeof w[k].update === 'function') wrap(w[k], 'update', k + '.update');
      wrap(w, 'update', 'world.update (all)'); wrap(fs.renderer, 'render', 'renderer.render'); wrap(fs.renderer, 'compile', 'renderer.compile');
      if (w.uniforms && w.uniforms.__clip) { wrap(w.uniforms.__clip, 'update', 'clip.update'); wrap(w.uniforms.__clip, 'flush', 'clip.flush'); }
      if (fs.sim) wrap(fs.sim, 'step', 'sim.step');
      try { new PerformanceObserver((l) => { for (const e of l.getEntries()) { p.tasks.push({ t: e.startTime, ms: +e.duration.toFixed(1), name: e.name }); if (p.tasks.length > 100) p.tasks.shift(); } }).observe({ entryTypes: ['longtask'] }); } catch (e) { /* none */ }
    }
    // v0.6.1: what the world held on each frame (cheap counts), so a long frame can say what had just changed.
    const snap = () => {
      const fs = window.__fs, w = fs.world, ri = fs.renderer && fs.renderer.info, s = fs.sim.state;
      const T = w && w.heightfield && w.heightfield.tiles, fine = w && w.terrain && w.terrain.fine;
      return { t: +s.t.toFixed(1), x: Math.round(s.pos.x / 1000), y: Math.round(s.pos.y / 1000), altM: Math.round(s.pos.z), aglM: Math.round(s.agl || 0),
        programs: ri && ri.programs ? ri.programs.length : -1, geo: ri ? ri.memory.geometries : -1, tex: ri ? ri.memory.textures : -1,
        tiles: T ? T.loads : -1, fine: fine ? fine.stats.uploads : -1, built: (w && w.stats && w.stats.airportsBuilt) || '',
        houses: w && w.rural ? w.rural.listed : -1, tunnels: w && w.greenhouses ? w.greenhouses.listed : -1, tris: ri ? ri.render.triangles : -1 };
    };
    const f = (t) => {
      if (p.on && p.last) {
        const d = t - p.last; p.dts.push(d);
        let now = null;
        try { now = snap(); } catch (e) { now = { err: String(e) }; }
        if (d > 25 && p.long.length < 12) {
          const L = { ms: +d.toFixed(1), now, before: p.prev }, t0 = p.last - 2;
          if (p.marksOn) { L.marks = p.marks.filter((m) => m.t >= t0).map((m) => `${m.name} ${m.ms}`); L.tasks = p.tasks.filter((m) => m.t + m.ms >= t0).map((m) => `${m.name} ${m.ms} @${(m.t - p.last).toFixed(0)}`); L.heapMB = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1; }
          p.long.push(L);
        }
        p.prev = now;
        if (d > p.worst) { p.worst = d; const s = window.__fs.sim.state; p.worstAt = { t: s.t, x: s.pos.x, y: s.pos.y }; }
      }
      p.last = t; requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  });
  const st = () => page.evaluate(() => {
    const f = window.__fs, s = f.sim.state, d = f.dest;
    return { t: s.t, x: s.pos.x, y: s.pos.y, z: s.pos.z, ias: s.ias, agl: s.agl, vs: s.vs, onGround: s.onGround, crashed: s.crashed, fuel: s.fuelKg, mach: s.mach,
      ap: f.ap.ap, ts: f.timeScale, ach: f.achievedScale, dist: d ? Math.hypot(d.end.x - s.pos.x, d.end.y - s.pos.y) : 0, altInd: s.altInd };
  });
  const waitFor = async (fn, ms, label, each = null) => {
    const t0 = Date.now();
    for (;;) {
      const s = await st();
      if (fn(s)) return s;
      if (s.crashed) throw new Error(`crashed while waiting for ${label}: ${s.crashed}`);
      if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${label}: ${JSON.stringify(s)}`);
      if (each) await each(s);
      await page.waitForTimeout(250);
    }
  };
  const shot = (name) => page.screenshot({ path: path.join(OUT, `v060-flight-${tag}-${name}.png`) });
  const mem = () => page.evaluate(async () => {
    if (window.gc) window.gc();
    await new Promise((r) => setTimeout(r, 200));
    const f = window.__fs, m = f.renderer.info.memory, T = f.world.heightfield.tiles;
    return { heapMB: Math.round(performance.memory.usedJSHeapSize / 1048576), geometries: m.geometries, textures: m.textures, tiles: T ? T.resident().length : 0, misses: T ? T.misses : 0, loads: T ? T.loads : 0, evictions: T ? T.evictions : 0 };
  });
  // The HDG bug towards the destination (magnetic), as the pilot of an A321 would keep turning it.
  const steer = () => page.evaluate(() => {
    const f = window.__fs, s = f.sim.state, e = f.dest.end;
    const brg = Math.atan2(e.x - s.pos.x, e.y - s.pos.y);
    const h = Math.round(f.gridToMagDeg(brg, s.pos.x, s.pos.y)) % 360 || 360;
    if (f.ap.lateral !== 'LOC' && f.ap.lateral !== 'ROLLOUT') f.ap.setHdg(h);
    return h;
  });
  const memAfter = [];

  for (let li = 0; li < opt.legs.length; li++) {
    const L = opt.legs[li], name = `${L.origin} ${L.dep} -> ${L.dest} ${L.arr}`;
    console.log(`\n== leg ${li + 1}: ${name}`);
    const route = await page.evaluate(({ L, li, fuel, type }) => {
      const f = window.__fs;
      const a = f.airports.find((q) => q.icao === L.origin), b = f.airports.find((q) => q.icao === L.dest);
      const nm = Math.hypot(a.origin[0] - b.origin[0], a.origin[1] - b.origin[1]) / 1852;
      if (li > 0) f.startFlight({ origin: L.origin, depRunway: L.dep, dest: L.dest, arrRunway: L.arr, start: L.final ? 'final' : 'runway', stand: null, pax: 180, cargoKg: 2000, fuelKg: L.final ? 6000 : fuel, waypoints: [], type: type || undefined });
      f.clock.set(Date.UTC(2026, 10, 19, f.region === 'europe' ? 11 : 2, 0, 0));   // 11:00 in Korea and Japan, 10:00 in China; v0.7.0: 11:00 UTC in Europe (midday)
      window.__e2e.phase = 'idle'; delete window.__e2e.rotateT; delete window.__e2e.liftT;
      return { nm, names: [a.shortName || a.name, b.shortName || b.name] };
    }, { L: { ...L, final: !!opt.final }, li, fuel: 17000, type: opt.type });
    console.log(`route ${route.names.join(' to ')}: ${route.nm.toFixed(0)} nm (map distance)`);
    if (!opt.final) {
    await page.waitForTimeout(2500);
    const g0 = await st();
    check(`${name}: on the runway at ${L.origin}`, g0.onGround && !g0.crashed, `z ${g0.z.toFixed(1)} m`);
    await shot(`${li + 1}a-lineup`);

    // Take-off.
    await page.evaluate((L) => {
      const f = window.__fs, r = f.runwayEnds(L.origin, L.dep), ax = f.runwayAxis(r.end, r.other);
      window.__e2e.rwyHdg = ax.hdg; window.__e2e.vr = f.sim.type.family === 'boeing' ? 155 : 148; window.__e2e.phase = 'takeoff';
      f.input.lever = 1;
    }, L);
    const lift = await waitFor((s) => !s.onGround && s.agl * FT > 50, 90000, 'lift-off');
    check(`${name}: lift-off`, true, `ias ${(lift.ias * KT).toFixed(0)} kt`);
    await page.keyboard.press('KeyG');
    await waitFor((s) => s.agl * FT > 1500, 120000, '1,500 ft');
    await shot(`${li + 1}b-climb-out`);
    await page.evaluate(() => { const f = window.__fs; f.input.lever = f.sim.type.family === 'boeing' ? f.input.lever : 25 / 45; window.__e2e.phase = 'idle'; });
    for (let k = 0; k < 8; k++) await page.keyboard.press('Minus');
    await page.evaluate((fl) => {
      const f = window.__fs, ap = f.ap;
      ap.setSpd(250); ap.setAlt(fl * 100);
      if (!ap.athr) ap.toggleAthr();
      ap.engageAp();
      ap.levelChange();
    }, opt.fl);
    await steer();
    await waitFor((s) => s.ap && s.agl * FT > 3000, 180000, 'the AP climbing through 3,000 ft', steer);
    const ts = await page.evaluate((r) => window.__fs.setTimeScale(r), opt.rate);
    check(`${name}: ${opt.rate}x time compression`, ts === opt.rate, `rate ${ts}`);
    await page.evaluate(() => { const p = window.__probe; p.dts = []; p.worst = 0; p.worstAt = null; p.last = 0; p.long = []; p.prev = null; p.on = true; });
    // Climb: 250 kt to 10,000 ft, then 270 kt (about M 0.79 at FL350), the HDG bug kept on the destination.
    let fast = false, lastSteer = 0, shotCruise = false;
    // A whole flight leaves the cruise 3 nm a thousand feet above the approach's start, plus 15 nm.
    const cruiseTo = opt.whole ? ((opt.fl * 100 - 4000) / 1000 * 3 + 30) * NM : 150 * NM;
    const tCruise = Date.now();
    await waitFor((s) => s.dist < (opt.whole ? cruiseTo : Math.min(cruiseTo, route.nm * NM * 0.45)) || s.dist < (opt.whole ? 40 : 70) * NM, 14 * 60000, 'the cruise', async (s) => {
      if (!fast && s.z * FT > 10500) { fast = true; await page.evaluate(() => window.__fs.ap.setSpd(270)); }
      if (Date.now() - lastSteer > 4000) { lastSteer = Date.now(); await steer(); }
      // v0.7.1: the picture is taken with the probe off. Headless Chrome's capture holds the page for a frame or two
      // (33 to 50 ms), and that was the whole of v0.7.0's "slow frame at 16x": one long frame just above the cruise
      // level less 500 ft, on both legs, every time (19,565 ft for --fl 200 south-east of Gatwick; 34,521 ft near Dijon).
      // E2E_SHOT_IN_PROBE=1 takes it with the probe on, as before, to show the frame again.
      if (!shotCruise && s.z * FT > opt.fl * 100 - 500) {
        shotCruise = true;
        const keep = !!process.env.E2E_SHOT_IN_PROBE;
        if (!keep) await page.evaluate(() => { window.__probe.on = false; });
        await shot(`${li + 1}c-cruise`);
        if (!keep) await page.evaluate(() => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => { const p = window.__probe; p.last = 0; p.prev = null; p.on = true; res(); }))));
      }
      if (s.ts !== opt.rate && s.ap) await page.evaluate((r) => window.__fs.setTimeScale(r), opt.rate);
    });
    const pr = await page.evaluate(() => { const p = window.__probe; p.on = false; const d = p.dts.slice().sort((a, b) => a - b); return { n: d.length, worst: p.worst, worstAt: p.worstAt, p99: d[Math.floor(d.length * 0.99)] || 0, p50: d[d.length >> 1] || 0, over25: d.filter((v) => v > 25).length, over34: d.filter((v) => v > 34).length, long: p.long }; });
    const c = await st();
    const m1 = await mem();
    console.log(`cruise: ${((Date.now() - tCruise) / 1000).toFixed(0)} s real, now ${(c.dist / NM).toFixed(0)} nm out at ${(c.z * FT).toFixed(0)} ft, M ${c.mach.toFixed(2)}, fuel ${c.fuel.toFixed(0)} kg, achieved ${c.ach}x`);
    console.log(`frames at ${opt.rate}x: ${pr.n}, median ${pr.p50.toFixed(1)} ms, p99 ${pr.p99.toFixed(1)} ms, worst ${pr.worst.toFixed(1)} ms (${pr.over25} over 25 ms, ${pr.over34} over 34 ms)${pr.worstAt ? ` at x ${(pr.worstAt.x / 1000).toFixed(0)} km y ${(pr.worstAt.y / 1000).toFixed(0)} km` : ''}`);
    for (const L of pr.long || []) console.log(`  long frame ${L.ms} ms: now ${JSON.stringify(L.now)} | the frame before ${JSON.stringify(L.before)}${L.marks ? ` | in it: ${L.marks.join(', ') || 'nothing over 1.5 ms'} | long tasks: ${L.tasks.join(', ') || 'none'} | heap ${L.heapMB} MB` : ''}`);
    check(`${name}: no hitch while tiles load (worst frame at most 25 ms)`, pr.worst <= 25, `worst ${pr.worst.toFixed(1)} ms`);
    check(`${name}: the sim never read a missing tile`, m1.misses === 0, `misses ${m1.misses}, ${m1.tiles} tiles resident, ${m1.loads} loaded, ${m1.evictions} released`);
    check(`${name}: reached the cruise level`, shotCruise || opt.whole && c.z * FT > opt.fl * 100 - 3000, `${(c.z * FT).toFixed(0)} ft`);

    if (opt.whole) {
      // The whole flight: descend on the autopilot to a fix 25 nm out on the extended centreline,
      // turn in and track the centreline inbound (the script turns the HDG bug as a pilot
      // intercepting a localizer would), level at the 3-degree path's height for 15 nm, 180 kt;
      // once established there the test pilot takes over, exactly where a skip to final starts.
      await page.evaluate(() => {
        const f = window.__fs, d = f.dest, ax = f.runwayAxis(d.end, d.other);
        const elev = d.end.elevM ?? d.airport.elevM;
        const ux = Math.sin(ax.hdg), uy = Math.cos(ax.hdg), R = 25 * 1852;
        const altM = elev + 15 + Math.tan(3 * Math.PI / 180) * 15 * 1852;        // placeOnFinal()'s height at 15 nm
        window.__fix = { x: d.end.x - ux * R, y: d.end.y - uy * R, ex: d.end.x, ey: d.end.y, ux, uy, hdg: ax.hdg, altFt: Math.round(altM * 3.28084 / 100) * 100 };
        f.ap.setAlt(window.__fix.altFt); f.ap.setSpd(250); f.ap.levelChange();
      });
      const guide = (phase) => page.evaluate((phase) => {
        const f = window.__fs, s = f.sim.state, x = window.__fix, DEG = Math.PI / 180;
        const rx = s.pos.x - x.ex, ry = s.pos.y - x.ey;
        const along = -(rx * x.ux + ry * x.uy), xte = rx * x.uy - ry * x.ux;     // m before the threshold; m right of the centreline
        const dFix = Math.hypot(x.x - s.pos.x, x.y - s.pos.y);
        // To the fix; then an intercept of up to 40 degrees, easing onto the centreline.
        const brg = phase === 'fix' ? Math.atan2(x.x - s.pos.x, x.y - s.pos.y) : x.hdg - Math.max(-1, Math.min(1, xte / 2500)) * 40 * DEG;
        f.ap.setHdg(Math.round(f.gridToMagDeg(brg, s.pos.x, s.pos.y)) % 360 || 360);
        const track = Math.atan2(s.vel.x, s.vel.y), off = Math.abs(Math.atan2(Math.sin(track - x.hdg), Math.cos(track - x.hdg))) / DEG;
        return { along, xte, dFix, off, altFt: s.pos.z * 3.28084, crashed: s.crashed, ts: f.timeScale };
      }, phase);
      let phase = 'fix', slow = false, established = false, q = null;
      const tD = Date.now();
      while (Date.now() - tD < 10 * 60000) {
        q = await guide(phase);
        if (q.crashed) throw new Error('crashed in the descent: ' + q.crashed);
        if (!slow && q.altFt < 11000) { slow = true; await page.evaluate(() => window.__fs.ap.setSpd(210)); }
        if (phase === 'fix' && q.dFix < 9000) {
          phase = 'intercept';
          await page.keyboard.press('Equal');                                      // flaps 1 (5 on a Boeing) for 180 kt, as a skip to final has them
          await page.evaluate(() => { window.__fs.ap.setSpd(180); window.__fs.setTimeScale(4); });
        }
        if (phase === 'intercept' && q.along < 18 * NM && q.ts > 2) await page.evaluate(() => window.__fs.setTimeScale(2));
        if (phase === 'intercept' && q.along < 15.2 * NM && Math.abs(q.xte) < 300 && q.off < 6) { established = true; break; }
        if (phase === 'intercept' && q.along < 11 * NM) break;                   // too late: not established
        await page.waitForTimeout(300);
      }
      await page.evaluate(() => window.__fs.setTimeScale(1));
      const fx = await st();
      check(`${name}: flown to the final (no skip), established on the centreline`, established && !fx.crashed, `${(q.along / NM).toFixed(1)} nm out, ${q.xte.toFixed(0)} m off the centreline, track ${q.off.toFixed(1)} deg off, ${(fx.z * FT).toFixed(0)} ft, ${(fx.ias * KT).toFixed(0)} kt`);
      await shot(`${li + 1}f-final`);
    } else {
      // The path map, the prediction over the new terrain, and a jump.
      await page.evaluate(() => window.__fs.setTimeScale(1));
      await steer();
      await page.keyboard.press('KeyN');
      await page.evaluate(() => { window.__predRes = null; const p = window.__fs.predictor, old = p.onresult; p.onresult = (r) => { window.__predRes = { cpuMs: r.cpuMs, terrain: r.terrain, reason: r.reason, n: r.samples.length }; if (old) old(r); }; window.__fs.requestPredict(); });
      await page.waitForFunction(() => window.__predRes && window.__fs.prediction && window.__fs.prediction.length > 5, null, { timeout: 40000 });
      const pres = await page.evaluate(() => window.__predRes);
      check(`${name}: the prediction over the new terrain within 2 s`, pres.cpuMs <= 2000 && pres.terrain === true, JSON.stringify(pres));
      await page.waitForTimeout(600);
      await shot(`${li + 1}d-map`);
      if (opt.jump) {
        const jump = await page.evaluate(() => {
          const f = window.__fs, p = f.prediction, e = f.dest.end;
          let best = p[0], bd = Infinity;
          for (const q of p) { const d = Math.abs(Math.hypot(q.x - e.x, q.y - e.y) - 60 * 1852); if (d < bd) { bd = d; best = q; } }
          f.jumpTo(best);
          return { x: best.x, y: best.y, z: best.z, t: best.t, n: p.length, off: bd };
        });
        await page.waitForTimeout(1500);
        const aj = await page.evaluate(() => { const s = window.__fs.sim.state; return { t: s.t, x: s.pos.x, y: s.pos.y, z: s.pos.z, vx: s.vel.x, vy: s.vel.y, vz: s.vel.z }; });
        const dtj = aj.t - jump.t;
        const miss = Math.hypot(aj.x - aj.vx * dtj - jump.x, aj.y - aj.vy * dtj - jump.y);
        check(`${name}: the jump lands on the predicted path`, dtj >= 0 && dtj < 8 && miss < 10, `${miss.toFixed(2)} m off after ${dtj.toFixed(2)} s; ${jump.n} samples`);
      }
      await page.keyboard.press('KeyN');
      await page.waitForTimeout(800);
      await shot(`${li + 1}e-after-jump`);

      // Skip to final, and the test pilot's landing.
      await page.evaluate(() => { window.__fs.setTimeScale(1); window.__fs.skipToFinal(); });
      await page.waitForTimeout(2000);
      const fin = await st();
      check(`${name}: skip to final at ${L.dest}`, !fin.crashed && fin.dist < 30 * NM, `${(fin.dist / NM).toFixed(1)} nm out at ${(fin.z * FT).toFixed(0)} ft, ${(fin.ias * KT).toFixed(0)} kt`);
      await shot(`${li + 1}f-final`);
    }
    } else {
      // --final: the route's flight starts on its 15 nm final (the setup's "On a 15 nm final");
      // the autopilot flies the 3-degree path down by V/S at 8x to 2,500 ft above the runway
      // (the guard's slots are shared), then 1x and the test pilot.
      await page.waitForTimeout(2500);
      const f0 = await st();
      check(`${name}: on the final at ${L.dest}`, !f0.crashed && f0.dist < 16 * NM && f0.dist > 13 * NM, `${(f0.dist / NM).toFixed(1)} nm out at ${(f0.z * FT).toFixed(0)} ft, ${(f0.ias * KT).toFixed(0)} kt`);
      await shot(`${li + 1}f-final`);
      await page.evaluate(() => { const f = window.__fs, d = f.dest, e = (d.end.elevM ?? d.airport.elevM) * 3.28084; f.ap.setAlt(Math.round((e + 2000) / 100) * 100); f.ap.setVs(-950); f.setTimeScale(8); });
      const tc = Date.now();
      while (Date.now() - tc < 90000) { const q = await st(); if (q.crashed) throw new Error('crashed on the final: ' + q.crashed); if (q.agl * FT < 2600) break; await page.waitForTimeout(200); }
      await page.evaluate(() => window.__fs.setTimeScale(1));
    }
    if (opt.noLand) {
      // --no-land (the leak check, inside the guard's 20 minutes for two legs): the leg ends on
      // the final, 8 s after the skip, with the arrival's airport, tiles and city built.
      await page.waitForTimeout(8000);
    } else {
    await page.evaluate(() => {
      const f = window.__fs, d = f.dest, ax = f.runwayAxis(d.end, d.other);
      window.__fsLastScore = null;
      window.__e2e.axis = { ...ax, elev: d.end.elevM ?? d.airport.elevM };
      window.__e2e.phase = 'approach';
    });
    await waitFor((s) => s.agl * FT < 1000, 400000, '1,000 ft on final');
    await shot(`${li + 1}g-short-final`);
    await waitFor((s) => s.onGround, 240000, 'touchdown');
    await page.waitForFunction(() => window.__fsLastScore, null, { timeout: 150000 });
    const score = await page.evaluate(() => { const c = window.__fsLastScore; return { grade: c.grade, points: c.points, runway: c.runway || c.runwayName || null, title: document.querySelector('#score')?.innerText?.slice(0, 160) || '' }; });
    await page.waitForTimeout(600);
    await shot(`${li + 1}h-score`);
    const end = await st();
    check(`${name}: landed, B or better`, !end.crashed && ['S', 'A', 'B'].includes(score.grade), `${score.grade} ${score.points}; ${score.title.replace(/\s+/g, ' ')}`);
    }
    const m2 = await mem();
    memAfter.push(m2);
    console.log(`after the leg: ${JSON.stringify(m2)}`);
    check(`${name}: no missing tile to the end`, m2.misses === 0, `misses ${m2.misses}`);
  }
  // The memory after the first and the last leg is compared only for a round trip (the brief's
  // "Gimpo–Haneda and back"): after legs to unrelated airports it counts what stands at each
  // place (Gimpo's cluster and Seoul against Kansai alone), not what has piled up.
  const roundTrip = opt.legs.length > 1 && opt.legs[0].origin === opt.legs[opt.legs.length - 1].dest;
  if (memAfter.length > 1 && !roundTrip) console.log(`memory after each leg (different places, not compared): ${memAfter.map((m) => `${m.heapMB} MB, ${m.geometries} geometries, ${m.textures} textures`).join(' | ')}`);
  if (memAfter.length > 1 && roundTrip) {
    const a = memAfter[0], b = memAfter[memAfter.length - 1];
    check('no leak: the heap and the textures after the last leg within 20 % of after the first', b.heapMB <= a.heapMB * 1.2 && b.textures <= a.textures * 1.2 && b.geometries <= a.geometries * 1.2, `${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
  }
  console.log('controller log:', (await page.evaluate(() => window.__e2eLog || [])).slice(-12).join(' | '));
  check('no console errors', errors.length === 0, errors.slice(0, 5).join(' || '));
} catch (e) {
  console.log('FAIL exception', e.message);
  try { const off = await globalThis.__page.evaluate(() => window.__probe && window.__probe.apOff); if (off && off.length) console.log('  autopilot off:', JSON.stringify(off)); } catch (e2) { /* the page is gone */ }
  results.push({ name: 'exception', ok: false });
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
