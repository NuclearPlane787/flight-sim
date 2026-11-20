// v0.6.0: how much room the GPU has left. The free camera (tests/dev-world.html, every part on)
// at a few of the heaviest views with Chrome's frame-rate limit and vsync off: the frames a
// second it then reaches say how far the 60 fps cap is from the edge (120: twice the room).
//   python3 games/flight-sim/tools/cpu-guard.py --minutes 5 -- node games/flight-sim/tests/browser-v060-headroom.mjs [--ground 0]
// Run it ALONE (no other browser rendering), or the numbers mean nothing.
import { chromium } from '/tmp/flight-sim/pw/node_modules/playwright/index.mjs';
import { toMap } from '../src/world/frame.js';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const ROOT = process.env.E2E_ROOT || 'http://127.0.0.1:8014/';
const ground = arg('--ground', '1');
const VIEWS = [['Tokyo, 3,000 ft', 35.66, 139.75, 3000, 20, -18], ['Seoul, 3,000 ft', 37.53, 126.98, 3000, 60, -18], ['Kanto plain, 1,000 ft', 36.05, 140.05, 1000, 30, -14],
  ['Narita, a stand', 35.772, 140.386, 150, 330, -10], ['Gimpo, on final 14R', 37.585, 126.765, 1000, 143, -8],
  // v0.6.1: two views full of small water (the nine-pixel water filter's cost shows here if anywhere).
  ['Yangtze delta, 1,000 ft', 31.25, 120.85, 1000, 280, -14], ['Nakdong delta, 1,000 ft', 35.13, 128.90, 1000, 200, -14]];
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist', '--disable-frame-rate-limit', '--disable-gpu-vsync'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  for (const [name, la, lo, alt, hdg, pitch] of VIEWS) {
    const [x, y] = toMap(la, lo);
    await page.goto(`${ROOT}games/flight-sim/tests/dev-world.html?hud=0&eastasia=1&cities=1&ground=${ground}&x=${x.toFixed(0)}&y=${y.toFixed(0)}&alt=${alt}&hdg=${hdg}&pitch=${pitch}`);
    await page.waitForFunction(() => window.__dev && window.__dev.info, null, { timeout: 90000 });
    const r = await page.evaluate(async () => {
      const d = window.__dev, w = d.world;
      const busy = () => (w.uniforms.__clip && w.uniforms.__clip.window.pending()) || (w.centres && [...w.centres.centres.values()].some((c) => ['loading', 'building', 'staging'].includes(c.state))) || (w.terrain.fine && w.terrain.fine.pending);
      const t0 = performance.now(); let quiet = 0;
      while (performance.now() - t0 < 60000 && quiet < 8000) { await new Promise((res) => setTimeout(res, 250)); quiet = busy() ? 0 : quiet + 250; }
      let n = 0; const t1 = performance.now();
      await new Promise((res) => { const tick = (t) => { n++; if (t - t1 < 5000) requestAnimationFrame(tick); else res(); }; requestAnimationFrame(tick); });
      return { fps: n / ((performance.now() - t1) / 1000), calls: d.info.calls, tris: d.info.triangles };
    });
    console.log(`${name}: ${r.fps.toFixed(0)} frames a second uncapped, ${r.calls} draws, ${(r.tris / 1000).toFixed(0)}k triangles (ground ${ground})`);
  }
} finally { await browser.close(); }
