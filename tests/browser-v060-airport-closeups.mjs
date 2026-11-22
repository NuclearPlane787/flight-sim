// v0.6.0: close-ups on the ground at the airports far from the map's origin (briefs/V0-6-0.md "Precision far from the
// origin"), against the same at Gimpo: the runway's paint, a painted taxiway name with its signs, a stand's
// lead-in and number, and the grass beside the runway (the terrain's fine noise). By day (13:00 KST), the
// region on, the free camera (dev-world.html). Headless, through the guard, from GameDump:
//   python3 games/flight-sim/tools/cpu-guard.py --minutes 10 -- node games/flight-sim/tests/browser-v060-airport-closeups.mjs \
//     --base http://127.0.0.1:8014/games/flight-sim/ [--tag closeup] [ICAO:END ...]
// Writes "Claude outputs/flight-sim/v060-<tag>-<icao>-<view>.png". Two frames 1/60 s apart are also compared
// (the camera still): a picture that swims shows differences there (printed as "swim").
import { chromium } from './pw.mjs';   // (v0.7.4: Playwright with every close on a timeout; the module itself is PW or /tmp/flight-sim/pw's)
import { mkdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OUT = decodeURIComponent(new URL('../../../Claude outputs/flight-sim', import.meta.url).pathname);
const argv = process.argv.slice(2);
const opt = { base: 'http://127.0.0.1:8014/games/flight-sim/', tag: 'closeup', ends: [] };
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--base') opt.base = argv[++i].replace(/\/?$/, '/');
  else if (argv[i] === '--tag') opt.tag = argv[++i];
  else opt.ends.push(argv[i]);
}
if (!opt.ends.length) opt.ends = ['RKSS:14R', 'RJTT:34L', 'RJAA:34L', 'RJBB:06R', 'ZSPD:35L'];
mkdirSync(OUT, { recursive: true });
const DAY = Date.UTC(2026, 10, 19, 4, 0);   // 13:00 KST

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'fs-close-')), {
  channel: 'chrome', headless: true, viewport: { width: 1280, height: 800 },
  args: ['--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'],
});
const page = ctx.pages()[0] || await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const summary = [];
for (const end of opt.ends) {
  const [icao, ident] = end.split(':');
  await page.goto(`${opt.base}tests/dev-world.html?hud=0&eastasia=1&rwy=${icao}:${ident}&back=200&eye=5`);
  await page.waitForFunction(() => window.__dev && window.__dev.ready, null, { timeout: 120000, polling: 250 });
  const shots = await page.evaluate(async ({ icao, ident, ms }) => {
    const d = window.__dev, w = d.world, cam = d.cam, DEG = Math.PI / 180;
    const frame = () => new Promise((r) => requestAnimationFrame(r));
    const { toGeo } = await import(new URL('../src/world/frame.js', location.href).href);
    const { taxiSignSites } = await import(new URL('../src/world/taxisigns.js', location.href).href);
    const a = w.airports.airports.find((x) => x.icao === icao), e = w.airports.findRunwayEnd(icao, ident);
    const sites = taxiSignSites(a);
    // The painted name nearest the airport's origin, the stand nearest it too (stable picks).
    const near = (list) => list.slice().sort((p, q) => Math.hypot(p.x - a.origin[0], p.y - a.origin[1]) - Math.hypot(q.x - a.origin[0], q.y - a.origin[1]))[0];
    const pt = near(sites.painted), st = near(a.stands.filter((s) => s.leadIn && s.leadIn.length > 1)) || near(a.stands);
    const sh = (st.hdgGridDeg || 0) * DEG;
    const views = {
      // On the runway 40 m before the threshold, eye 4 m: the stripes and the designator.
      runway: { x: e.thrX - e.ux * 40, y: e.thrY - e.uy * 40, h: e.elevM + 4, hdg: e.hdgGridDeg * DEG, pitch: -12 * DEG },
      // 30 m before a painted taxiway name, eye 6 m, looking along the traffic: the name and its sign array.
      taxiway: { x: pt.x - pt.tx * 30, y: pt.y - pt.ty * 30, h: w.heightAt(pt.x, pt.y) + 6, hdg: Math.atan2(pt.tx, pt.ty), pitch: -14 * DEG },
      // Above a stand's lead-in, 20 m up, 45 m out along its heading, looking back at it: the line and the number.
      stand: { x: st.x + Math.sin(sh) * 45, y: st.y + Math.cos(sh) * 45, h: w.heightAt(st.x, st.y) + 20, hdg: sh + Math.PI, pitch: -28 * DEG },
      // 120 m to the side of the runway's threshold, 2 m up, looking at the grass and the runway's edge.
      grass: { x: e.thrX + e.uy * 120 + e.ux * 300, y: e.thrY - e.ux * 120 + e.uy * 300, h: 0, hdg: Math.atan2(-e.uy, e.ux), pitch: -10 * DEG },
    };
    views.grass.h = w.heightAt(views.grass.x, views.grass.y) + 2;
    const out = {};
    for (const [name, v] of Object.entries(views)) {
      Object.assign(cam, { x: v.x, y: v.y, z: v.h, hdg: v.hdg, pitch: v.pitch });
      if (w.heightfield.tiles) await w.heightfield.tiles.whenReady(v.x, v.y, 20000, 'camera');
      const [lat, lon] = toGeo(v.x, v.y);
      w.sky.setTime(ms, lat, lon);
      if (Number.isFinite(w.sky.state.exposure)) d.renderer.toneMappingExposure = w.sky.state.exposure;
      for (let i = 0; i < 40; i++) await frame();
      const scene = w.runways.group.parent, origin = { x: cam.x, y: cam.y };
      const draw = () => { w.update({ camera: d.camera, origin, state: null, dt: 1 / 60 }); d.renderer.render(scene, d.camera); return d.renderer.domElement.toDataURL('image/png'); };
      const url = draw(), url2 = draw();
      out[name] = { url, same: url === url2, at: { x: +v.x.toFixed(1), y: +v.y.toFixed(1) }, built: w.airportSet ? w.airportSet.built() : null };
    }
    return out;
  }, { icao, ident, ms: DAY });
  for (const [name, s] of Object.entries(shots)) {
    const file = `${OUT}/v060-${opt.tag}-${icao.toLowerCase()}-${name}.png`;
    writeFileSync(file, Buffer.from(s.url.split(',')[1], 'base64'));
    summary.push({ icao, name, file, at: s.at, stillFramesIdentical: s.same, built: s.built });
    console.log(`${icao} ${name}: x ${s.at.x} y ${s.at.y}${s.same ? '' : '  (two still frames differ: swim or animation)'} -> ${file}`);
  }
}
if (errors.length) console.log('errors:', errors.join('\n'));
writeFileSync(`/tmp/flight-sim/v060/airport-set-work/closeups-${opt.tag}.json`, JSON.stringify({ summary, errors }, null, 2));
await ctx.close();
