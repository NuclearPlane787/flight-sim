// v0.6.0: where a long frame in the GAME comes from (browser-v060-hitch.mjs is the free
// camera's). Parked at a gate at ICAO, the outside view; the world's parts and the renderer are
// timed from outside for 24 s (day, then night from 8 s, then day again from 16 s), and every
// frame over 25 ms is printed with what ran in it.
//   python3 games/flight-sim/tools/cpu-guard.py --minutes 4 -- node games/flight-sim/tests/browser-v060-slowframes.mjs RJAA [stand]
import { chromium } from './pw.mjs';   // (v0.7.4: Playwright with every close on a timeout; the module itself is PW or /tmp/flight-sim/pw's)
const BASE = process.env.E2E_URL || 'http://127.0.0.1:8014/games/flight-sim/';
const icao = process.argv[2] || 'RJAA', stand = process.argv[3] || '11';
const RW = { RJAA: '34L', RJTT: '34L', ZSSS: '36R', ZSPD: '34L', RJBB: '06R', RJFF: '16L', RKPK: '36L', ZSQD: '34', ZSYN: '04', RKSS: '14R' }[icao];
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-precise-memory-info'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${BASE}?test&eastasia=1&cities=1&ground=0&origin=${icao}&dep=${RW}&dest=${icao}&arr=${RW}&start=gate&stand=${encodeURIComponent(stand)}&view=orbit`);
  await page.waitForFunction(() => window.__fs && window.__fs.gate && window.__fs.gate.phase === 'parked' && window.__fs.frames > 5, null, { timeout: 60000 });
  const res = await page.evaluate(async () => {
    const f = window.__fs, w = f.world, marks = [];
    const wrap = (obj, fn, name) => {
      if (!obj || typeof obj[fn] !== 'function') return;
      const g = obj[fn].bind(obj);
      obj[fn] = (...a) => { const t = performance.now(); const r = g(...a); const ms = performance.now() - t; if (ms > 2) marks.push({ name, t, ms }); return r; };
    };
    for (const k of ['terrain', 'cities', 'cityLights', 'runways', 'aprons', 'traffic', 'taxiLights', 'trees', 'sky', 'clouds', 'precip', 'landmarks', 'centres', 'rural']) wrap(w[k], 'update', k + '.update');
    wrap(w, 'update', 'world.update (all)'); wrap(f.renderer, 'render', 'renderer.render'); wrap(f.renderer, 'compile', 'renderer.compile');
    const clip = w.uniforms.__clip; wrap(clip, 'update', 'clip.update'); wrap(clip, 'flush', 'clip.flush');
    const long = [];
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) long.push({ t: e.startTime, ms: e.duration, name: e.name }); }).observe({ entryTypes: ['longtask'] }); } catch (e) { /* none */ }
    const frames = [];
    const t0 = performance.now(); let last = t0, phase = 0;
    const base = Date.UTC(2026, 10, 19, 3, 0, 0);
    await new Promise((res) => {
      const tick = (t) => {
        frames.push({ t, dt: t - last }); last = t;
        const el = t - t0;
        if (phase === 0 && el > 8000) { phase = 1; f.clock.set(base + 11 * 3600e3); marks.push({ name: '(night set)', t, ms: 0 }); }
        if (phase === 1 && el > 16000) { phase = 2; f.clock.set(base); marks.push({ name: '(day set)', t, ms: 0 }); }
        if (el < 24000) requestAnimationFrame(tick); else res();
      };
      requestAnimationFrame(tick);
    });
    const slow = frames.slice(2).filter((x) => x.dt > 25).map((x) => ({ at: ((x.t - t0) / 1000).toFixed(2), dt: x.dt.toFixed(1),
      why: marks.filter((m) => m.t >= x.t - x.dt - 2 && m.t <= x.t + 1 && m.name !== 'world.update (all)').map((m) => `${m.name} ${m.ms.toFixed(1)}`),
      long: long.filter((m) => m.t + m.ms >= x.t - x.dt - 2 && m.t <= x.t + 1).map((m) => `longtask ${m.ms.toFixed(0)}`) }));
    const st = w.centres?.stats, lm = w.landmarks?.stats;
    return { n: frames.length, slow, staging: st ? JSON.stringify(st).slice(0, 300) : '', lm: lm ? JSON.stringify(lm).slice(0, 200) : '', mem: f.renderer.info.memory };
  });
  console.log(`${icao} stand ${stand}: ${res.n} frames in 24 s, ${res.slow.length} over 25 ms`);
  for (const s of res.slow) console.log(`  at ${s.at} s: ${s.dt} ms: ${[...s.why, ...s.long].join('; ') || '(nothing of the world\'s over 2 ms, no long task)'}`);
  console.log('centres', res.staging, '| landmarks', res.lm, '| memory', JSON.stringify(res.mem));
  if (errors.length) console.log('console errors:', errors.slice(0, 3).join(' | '));
} finally { await browser.close(); }
