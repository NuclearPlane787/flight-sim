// v0.6.0 Part 6 step 2: the dense centres (src/world/centres.js) in headless Chrome on the Mac's GPU.
// One page a centre (tests/dev-centres.html with ?cities=1&eastasia=1): the tiles round the view first,
// then the centres made and run on real frames (the load and build time, the worst frame while it builds,
// the JS heap before and after), then pictures with a fixed clock and the numbers at each (fps over 3 s,
// draw calls and triangles, with the centres on and off). From GameDump, through the CPU guard:
//   python3 games/flight-sim/tools/cpu-guard.py --minutes 20 -- node games/flight-sim/tests/browser-v060-centres.mjs \
//     --base http://127.0.0.1:8014/games/flight-sim/ [ids ...] [--procedural]
// Pictures: "Claude outputs/flight-sim/v060-cities-<id>-<3000|fl350|low>-<day|night>.png"; the numbers in
// /tmp/flight-sim/v060/centres-render-work/centres.json. By default the procedural blocks (cities.js) are
// hidden so the real buildings can be judged (cities.js doesn't read the mask yet); --procedural keeps them.
import { chromium } from '/tmp/flight-sim/pw/node_modules/playwright/index.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { toMap } from '../src/world/frame.js';

const OUT = decodeURIComponent(new URL('../../../Claude outputs/flight-sim', import.meta.url).pathname);
const WORK = '/tmp/flight-sim/v060/centres-render-work';
const FT = 0.3048, DEG = Math.PI / 180;
const DAY = Date.UTC(2026, 10, 19, 4), NIGHT = Date.UTC(2026, 10, 19, 13);

// A camera looking at a ground point from aglFt above it, the point mid-frame at that pitch.
function look(lat, lon, aglFt, hdg, pitch) {
  const [tx, ty] = toMap(lat, lon), d = (aglFt * FT) / Math.tan(-pitch * DEG);
  return { x: tx - d * Math.sin(hdg * DEG), y: ty - d * Math.cos(hdg * DEG), aglFt, hdg, pitch, tx, ty };
}
// Per centre: the 3,000 ft view (target lat, lon, heading, pitch); for three of them FL350 and a low pass.
const VIEWS = {
  tokyo: { t3000: [35.683, 139.745, 265, -12], fl350: [35.680, 139.735, 290, -28], low: [35.690, 139.694, 270, -4] },
  shanghai: { t3000: [31.236, 121.500, 80, -12], fl350: [31.235, 121.500, 75, -30], low: [31.238, 121.506, 60, -3.5] },
  seoul: { t3000: [37.525, 126.930, 80, -12], fl350: [37.520, 127.000, 80, -28], low: [37.5045, 127.045, 68, -4] },
  busan: { t3000: [35.160, 129.140, 45, -12] },
  osaka: { t3000: [34.698, 135.498, 0, -12] },
  fukuoka: { t3000: [33.590, 130.400, 100, -12] },
  qingdao: { t3000: [36.064, 120.385, 10, -12] },
  songdo: { t3000: [37.392, 126.642, 45, -12] },
  yokohama: { t3000: [35.457, 139.634, 280, -12] },
};
const FEET = { t3000: 3000, fl350: 35000, low: 1000 };
const TAG = { t3000: '3000', fl350: 'fl350', low: 'low' };

const argv = process.argv.slice(2);
let base = null;
const ids = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--base') base = argv[++i];
  else if (!argv[i].startsWith('--')) ids.push(argv[i]);
}
const PROCEDURAL = argv.includes('--procedural');
if (!base) { console.error('usage: node browser-v060-centres.mjs --base <game folder url> [ids]'); process.exit(2); }
if (!base.endsWith('/')) base += '/';
const list = ids.length ? ids : Object.keys(VIEWS);
mkdirSync(OUT, { recursive: true });
mkdirSync(WORK, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--js-flags=--expose-gc'] });
const results = {};
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  for (const id of list) {
    const V = VIEWS[id];
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    const v0 = look(V.t3000[0], V.t3000[1], 3000, V.t3000[2], V.t3000[3]);
    const url = `${base}tests/dev-centres.html?hud=0&cities=1&eastasia=1&centresLater=1${PROCEDURAL ? '' : '&hideprocedural=1'}&x=${v0.x.toFixed(1)}&y=${v0.y.toFixed(1)}&alt=3000&hdg=${v0.hdg}&pitch=${v0.pitch}`;
    const t0 = Date.now();
    await page.goto(url);
    try {
      await page.waitForFunction(() => window.__dev && window.__dev.ready, null, { timeout: 120000, polling: 250 });
    } catch {
      console.log(id, 'did not start', errors.join('\n'));
      results[id] = { error: 'timeout', errors };
      await page.close();
      continue;
    }
    // Tiles round the view, then the centres on real frames: the build's numbers.
    const build = await page.evaluate(async ({ v }) => {
      const d = window.__dev, w = d.world, T = w.heightfield.tiles;
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const tilesT0 = performance.now();
      if (T) { await T.whenReady(v.x, v.y, 40000, 'camera'); await T.whenReady(v.tx, v.ty, 8000, 'target'); }
      const clip = w.uniforms.__clip;
      for (let i = 0; i < 600 && clip && clip.window.pending(); i++) await sleep(50);
      await sleep(500);
      d.cam.z = w.heightAt(v.tx, v.ty) + v.aglFt * 0.3048;
      const tilesMs = performance.now() - tilesT0;
      if (window.gc) window.gc();
      await sleep(300);
      const heap0 = performance.memory ? performance.memory.usedJSHeapSize : 0;
      // The frames while the centre loads, builds and is uploaded.
      const stamps = [];
      d.frameLog = [];
      let on = true;
      const tick = (ts) => { stamps.push(ts); if (on) requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
      const c = d.startCentres();
      const s0 = performance.now();
      while (performance.now() - s0 < 40000 && !(c.log && c.log.length)) await sleep(20);
      const readyMs = performance.now() - s0;
      await sleep(1000);
      on = false;
      let worst = 0;
      for (let i = 1; i < stamps.length; i++) worst = Math.max(worst, stamps[i] - stamps[i - 1]);
      const sorted = stamps.slice(1).map((t, i) => t - stamps[i]).sort((a, b) => a - b);
      if (window.gc) window.gc();
      await sleep(300);
      const heap1 = performance.memory ? performance.memory.usedJSHeapSize : 0;
      // The slowest frames while it built, with what the centres were staging and the frame's CPU time.
      const fl = d.frameLog; d.frameLog = null;
      const slow = fl.map((f, i) => ({ dt: i ? f.t - fl[i - 1].t : 0, cpu: +f.cpu.toFixed(2), upd: +f.upd.toFixed(2), staging: f.staging, prev: i ? fl[i - 1].staging : '' })).sort((a, b) => b.dt - a.dt).slice(0, 5);
      return { slow, tilesMs, readyMs, worstFrameMs: worst, p99FrameMs: sorted[Math.floor(sorted.length * 0.99)] || 0, frames: stamps.length, heap0, heap1, log: c.log.slice(), glRenderer: (() => { const gl = d.renderer.getContext(), x = gl.getExtension('WEBGL_debug_renderer_info'); return x ? gl.getParameter(x.UNMASKED_RENDERER_WEBGL) : ''; })() };
    }, { v: v0 });
    console.log(id, 'slowest frames while building:', JSON.stringify(build.slow));
    console.log(id, 'tiles', build.tilesMs.toFixed(0), 'ms; ready after', build.readyMs.toFixed(0), 'ms; worst frame', build.worstFrameMs.toFixed(1), 'ms (p99', build.p99FrameMs.toFixed(1) + '); heap', (build.heap0 / 1e6).toFixed(0), '->', (build.heap1 / 1e6).toFixed(0), 'MB;', JSON.stringify(build.log[0] || {}));
    const shots = [];
    for (const kind of Object.keys(V)) {
      const [la, lo, hdg, pitch] = V[kind];
      const v = look(la, lo, FEET[kind], hdg, pitch);
      for (const [tod, ms] of kind === 't3000' || (kind === 'low' && id === 'tokyo') ? [['day', DAY], ['night', NIGHT]] : [['day', DAY]]) {
        const name = `v060-cities-${id}-${TAG[kind]}-${tod}`;
        const r = await page.evaluate(async ({ v, ms, measure }) => {
          const d = window.__dev, w = d.world, T = w.heightfield.tiles;
          const sleep = (t) => new Promise((res) => setTimeout(res, t));
          const { toGeo } = await import(new URL('../src/world/frame.js', location.href).href);
          d.cam.x = v.x; d.cam.y = v.y; d.cam.hdg = v.hdg * Math.PI / 180; d.cam.pitch = v.pitch * Math.PI / 180;
          if (T) { await T.whenReady(v.x, v.y, 40000, 'camera'); await T.whenReady(v.tx, v.ty, 8000, 'target'); }
          d.cam.z = w.heightAt(v.tx, v.ty) + v.aglFt * 0.3048;
          const clip = w.uniforms.__clip;
          for (let i = 0; i < 600 && clip && clip.window.pending(); i++) await sleep(50);
          const [lat, lon] = toGeo(d.cam.x, d.cam.y);
          w.sky.setTime(ms, lat, lon);
          await sleep(600);
          if (Number.isFinite(w.sky.state.exposure)) d.renderer.toneMappingExposure = w.sky.state.exposure;
          await sleep(900);
          const url = d.capture();
          const info = { ...d.info };
          const U = w.uniforms;
          const out = { url, calls: info.calls, triangles: info.triangles, centres: info.centres, night: U.uNight.value, sun: U.uSunColor.value.toArray().map((x) => +x.toFixed(3)), amb: U.uSkyAmb.value.toArray().map((x) => +x.toFixed(3)), exposure: d.renderer.toneMappingExposure };
          if (measure) {
            // fps over 3 s with the centres on, then off (their group hidden), and the draws and triangles each way.
            const fpsOver = async () => {
              const st = [];
              let go = true;
              const tick = (ts) => { st.push(ts); if (go) requestAnimationFrame(tick); };
              requestAnimationFrame(tick);
              await sleep(3000);
              go = false;
              let worst = 0;
              for (let i = 1; i < st.length; i++) worst = Math.max(worst, st[i] - st[i - 1]);
              return { fps: (st.length - 1) / ((st[st.length - 1] - st[0]) / 1000), worstMs: worst, calls: d.info.calls, triangles: d.info.triangles };
            };
            await sleep(1000);                 // past the capture's own hitch
            out.on = await fpsOver();
            out.on.renderMs = d.renderCost();
            d.centres.group.visible = false;
            await sleep(300);
            out.off = await fpsOver();
            out.off.renderMs = d.renderCost();
            d.centres.group.visible = true;
            await sleep(300);
          }
          return out;
        }, { v, ms, measure: true });
        writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.url.split(',')[1], 'base64'));
        delete r.url;
        shots.push({ name, ...r });
        const f = (o) => (o ? `${o.fps.toFixed(1)} fps (worst ${o.worstMs.toFixed(1)} ms, render ${o.renderMs.toFixed(2)} ms), ${o.calls} draws, ${(o.triangles / 1000).toFixed(0)}k tris` : '');
        console.log(' ', name, `| night ${r.night.toFixed(2)} sun ${r.sun} amb ${r.amb} exp ${r.exposure.toFixed(2)}`, '| centres', r.centres ? `${r.centres.drawCalls} draws ${(r.centres.triangles / 1000).toFixed(0)}k tris` : '-', '| on:', f(r.on), '| off:', f(r.off));
      }
    }
    // Released beyond 120 km: no draws, the mask off (its version up), and the heap it gave back.
    const rel = await page.evaluate(async () => {
      const d = window.__dev, c = d.centres;
      const sleep = (t) => new Promise((res) => setTimeout(res, t));
      if (window.gc) window.gc();
      await sleep(300);
      const heapBefore = performance.memory ? performance.memory.usedJSHeapSize : 0;
      const v0 = c.maskVersion();
      const x0 = d.cam.x;
      d.cam.x += 200000; d.cam.z = 3000;
      await sleep(800);
      const after = { draws: c.stats.drawCalls, loaded: c.stats.loaded, maskVersion: c.maskVersion() - v0, children: c.group.children.length };
      if (window.gc) window.gc();
      await sleep(300);
      const heapAfter = performance.memory ? performance.memory.usedJSHeapSize : 0;
      d.cam.x = x0;
      return { ...after, heapBefore, heapAfter };
    });
    console.log(' ', id, 'released:', JSON.stringify(rel), 'heap given back', ((rel.heapBefore - rel.heapAfter) / 1e6).toFixed(1), 'MB');
    results[id] = { build, shots, release: rel, errors: errors.slice(0, 20), seconds: (Date.now() - t0) / 1000 };
    if (errors.length) console.log(' ', id, 'console:', errors.slice(0, 5).join(' | '));
    await page.close();
    writeFileSync(`${WORK}/centres.json`, JSON.stringify(results, null, 1));
  }
} finally {
  await browser.close();
}
writeFileSync(`${WORK}/centres.json`, JSON.stringify(results, null, 1));
