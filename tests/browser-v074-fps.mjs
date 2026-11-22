// v0.7.4's frame rates in the game itself (not the free camera): each case is a name and the game's query; the page
// is opened in test mode, left to settle, and its frames are counted over 6 s of real time, with the worst frame, the
// draws and the triangles. Run ALONE on the CPU and the GPU, on mains (briefs/V0-7-4.md, part 6):
//   /tmp/flight-sim/v074/gk.sh ex 8 lead/fps.txt '^(PASS|FAIL) ' node games/flight-sim/tests/browser-v074-fps.mjs
// Cases: a final at Incheon and at Heathrow in the outside view with the gear down (the new gear in view), and
// Frankfurt's final in the destination's thunderstorm with Heathrow clear (weather by place). The stands' frame rates
// are tests/browser-v060-stand-fps.mjs's. Env: E2E_URL (default http://127.0.0.1:8014/games/flight-sim/).
import { chromium } from './pw.mjs';

const BASE = process.env.E2E_URL || 'http://127.0.0.1:8014/games/flight-sim/';
const CASES = [
  ['Incheon 33R final, outside view, gear down', 'origin=RKSS&dep=14R&dest=RKSI&arr=33R&start=final&view=orbit', true],
  ['Heathrow 27R final, outside view, gear down', 'region=europe&origin=EGKK&dep=26L&dest=EGLL&arr=27R&start=final&view=orbit', true],
  ["Frankfurt 07R final in the destination's thunderstorm (Heathrow clear), cockpit", 'region=europe&origin=EGLL&dep=27R&dest=EDDF&arr=07R&start=final&weather=clear&weatherDest=thunderstorm', false],
  ["Frankfurt 07R final in the destination's thunderstorm, outside view, gear down", 'region=europe&origin=EGLL&dep=27R&dest=EDDF&arr=07R&start=final&weather=clear&weatherDest=thunderstorm&view=orbit', true],
];
const only = process.argv[2] ? new RegExp(process.argv[2], 'i') : null;
const browser = await chromium.launch({ channel: 'chrome', headless: !process.argv.includes('--headed'), args: ['--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-precise-memory-info'] });
let bad = 0;
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  for (const [name, q, gear] of CASES) {
    if (only && !only.test(name)) continue;
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`${BASE}?test&${q}`);
    await page.waitForFunction(() => window.__fs && window.__fs.frames > 60 && window.__fs.sim && window.__fs.sim.state, null, { timeout: 90000 });
    if (gear) await page.evaluate(() => { const c = window.__fs.sim.controls; if (c && 'gear' in c) c.gear = 1; if (c && 'gearDown' in c) c.gearDown = true; });
    await page.waitForTimeout(5000);
    const r = await page.evaluate(async () => {
      const f = window.__fs, f0 = f.frames, t0 = performance.now();
      let worst = 0, last = t0, over = 0;
      await new Promise((res) => { const tick = (t) => { const d = t - last; if (d > worst) worst = d; if (d > 25) over++; last = t; if (t - t0 < 6000) requestAnimationFrame(tick); else res(); }; requestAnimationFrame(tick); });
      const ri = f.renderer.info.render, s = f.sim.state;
      return { fps: (f.frames - f0) / ((performance.now() - t0) / 1000), worst, over, draws: ri.calls, tris: ri.triangles, gear: s.gear ?? s.gearPos ?? null, agl: s.agl };
    });
    const ok = r.fps >= 59 && errors.length === 0;
    if (!ok) bad++;
    console.log(`${ok ? 'ok  ' : 'LOW '} ${name}: ${r.fps.toFixed(1)} fps, worst frame ${r.worst.toFixed(1)} ms, ${r.over} over 25 ms, ${r.draws} draws, ${(r.tris / 1000).toFixed(0)}k triangles, gear ${typeof r.gear === 'number' ? r.gear.toFixed(2) : r.gear}, ${Math.round((r.agl || 0) * 3.28084)} ft${errors.length ? '; console: ' + errors.slice(0, 2).join(' | ') : ''}`);
    await page.close();
  }
} finally { await browser.close(); }
console.log(bad ? `FAIL ${bad} case(s) under 59 fps or with console errors` : 'PASS 60 fps in every case');
process.exit(bad ? 1 : 0);
