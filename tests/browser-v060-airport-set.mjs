// v0.6.0: the airports built near the camera (src/world/airport-set.js), in the browser. The free camera
// (tests/dev-world.html, the region on) flies at FL350 (0.5 km a frame: 100 times an airliner's speed) from Gimpo to Haneda, to Pudong and back to Gimpo, then
// lands on each airport's final for a moment; for each leg it logs the airports built and released (with their
// build times by part), renderer.info.memory, the heap and the worst frame. Then a release check: everything
// released, then rebuilt, and renderer.info.memory's geometries and textures back to where they were.
// Headless, through the guard, from GameDump:
//   python3 games/flight-sim/tools/cpu-guard.py --minutes 10 -- node games/flight-sim/tests/browser-v060-airport-set.mjs \
//     --base http://127.0.0.1:8014/games/flight-sim/
// Writes /tmp/flight-sim/v060/airport-set-work/browser-airport-set.json; exits 1 on a failed check.
import { chromium } from '/tmp/flight-sim/pw/node_modules/playwright/index.mjs';
import { mkdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const a = process.argv.slice(2);
const base = (a[a.indexOf('--base') + 1] || 'http://127.0.0.1:8014/games/flight-sim/').replace(/\/?$/, '/');
const OUT = '/tmp/flight-sim/v060/airport-set-work';
mkdirSync(OUT, { recursive: true });

const ctxDir = mkdtempSync(join(tmpdir(), 'fs-aset-'));
const browser = await chromium.launchPersistentContext(ctxDir, {
  channel: 'chrome', headless: true, viewport: { width: 1280, height: 800 },
  args: ['--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--js-flags=--expose-gc'],
});
const page = browser.pages()[0] || await browser.newPage();
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
  if (/airports .* built/.test(m.text())) console.log('  ', m.text());
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
await page.goto(`${base}tests/dev-world.html?hud=0&eastasia=1&rwy=RKSS:14R`);
await page.waitForFunction(() => window.__dev && window.__dev.ready, null, { timeout: 120000, polling: 250 });

const result = await page.evaluate(async () => {
  const d = window.__dev, w = d.world, cam = d.cam, set = w.airportSet;
  const scene = w.runways.group.parent;
  const mem = () => ({ ...d.renderer.info.memory, programs: d.renderer.info.programs?.length ?? null, heapMB: +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) });
  const frame = () => new Promise((res) => requestAnimationFrame((t) => res(t)));
  const at = (icao) => { const p = w.airports.airports.find((x) => x.icao === icao); return { x: p.origin[0], y: p.origin[1] }; };
  const logFrom = () => set.log.length;
  // The manager's own time each frame (building and releasing), apart from the rest of the frame.
  const up = set.update.bind(set);
  let setMs = 0;
  set.update = (...args) => { const t = performance.now(); const r = up(...args); setMs = performance.now() - t; return r; };
  const legs = [];
  // Wait for the tiles round the camera (the region's store), as the stills tool does.
  if (w.heightfield.tiles) await w.heightfield.tiles.whenReady(cam.x, cam.y, 40000, 'camera');
  for (let i = 0; i < 30; i++) await frame();

  async function leg(name, to, kmPerFrame = 0.5) {
    const from = { x: cam.x, y: cam.y }, L = Math.hypot(to.x - from.x, to.y - from.y), n = Math.max(1, Math.ceil(L / (kmPerFrame * 1000)));
    const l0 = logFrom(), seen = new Set();
    let worst = 0, last = await frame(), worstAt = null, sumDt = 0, worstSet = 0;
    cam.z = 10668; cam.pitch = -0.05;
    cam.hdg = Math.atan2(to.x - from.x, to.y - from.y);
    for (let i = 1; i <= n; i++) {
      cam.x = from.x + (to.x - from.x) * i / n; cam.y = from.y + (to.y - from.y) * i / n;
      const t = await frame(), dt = t - last; last = t; sumDt += dt;
      if (dt > worst) { worst = dt; worstAt = { i, built: set.built().join(' '), building: set.building().join(' '), setMs: +setMs.toFixed(1) }; }
      worstSet = Math.max(worstSet, setMs);
      for (const id of set.built()) seen.add(id);
    }
    // Wait for the destination's tiles, then a moment on its final (1,000 ft, 5.8 km out).
    if (w.heightfield.tiles) await w.heightfield.tiles.whenReady(to.x, to.y, 30000, 'camera');
    for (let i = 0; i < 20; i++) await frame();
    const events = set.log.slice(l0);
    return { name, km: +(L / 1000).toFixed(0), frames: n, meanMs: +(sumDt / n).toFixed(2), worstMs: +worst.toFixed(1), worstAt, worstSetMs: +worstSet.toFixed(1), seenBuilt: [...seen], events, builtAtEnd: set.built(), mem: mem() };
  }
  async function onFinal(icao, ident) {
    const e = w.airports.findRunwayEnd(icao, ident);
    const h = 1000 * 0.3048, dd = h / Math.tan(3 * Math.PI / 180) - 300;
    cam.x = e.thrX - e.ux * dd; cam.y = e.thrY - e.uy * dd; cam.z = e.elevM + h; cam.hdg = e.hdgGridDeg * Math.PI / 180; cam.pitch = -4 * Math.PI / 180;
    let worst = 0, last = await frame();
    for (let i = 0; i < 90; i++) { const t = await frame(); worst = Math.max(worst, t - last); last = t; }
    const ri = d.renderer.info.render;
    return { icao, ident, calls: ri.calls, triangles: ri.triangles, worstMs: +worst.toFixed(1), built: set.built(), stats: { ...w.stats } };
  }

  const f0 = await onFinal('RKSS', '14R');
  const start = { built: set.built(), mem: mem(), final: f0 };
  legs.push(await leg('Gimpo to Haneda', at('RJTT')));
  const fRJTT = await onFinal('RJTT', '34L');
  legs.push(await leg('Haneda to Pudong', at('ZSPD')));
  const fZSPD = await onFinal('ZSPD', '35L');
  legs.push(await leg('Pudong to Gimpo', at('RKSS')));
  const fRKSS = await onFinal('RKSS', '14R');
  const back = { built: set.built(), mem: mem() };

  // The release check, back at Gimpo: everything released and drawn without it, then rebuilt.
  const m0 = { ...d.renderer.info.memory };
  set.releaseAll();
  d.renderer.render(scene, d.camera);
  const m1 = { ...d.renderer.info.memory }, emptyBuilt = set.built().length, groups = ['runways', 'aprons', 'traffic', 'taxiLights'].map((k) => w[k]?.group?.children.length ?? 0);
  for (let i = 0; i < 10; i++) await frame();
  const m2 = { ...d.renderer.info.memory };
  // Build times: every 'built' event in the log.
  const builds = set.log.filter((r) => r.event === 'built').map((r) => ({ id: r.id, ms: +r.ms.toFixed(1), slices: r.slices, worstSliceMs: +r.worstSlice.toFixed(1), worstSliceName: r.worstSliceName, parts: r.parts.map((p) => `${p.name} ${p.ms.toFixed(1)}`) }));
  return { start, legs, finals: [fRJTT, fZSPD, fRKSS], back, release: { before: m0, released: m1, emptyBuilt, groupsWhenReleased: groups, rebuilt: m2, builtAgain: set.built() }, builds, counts: set.counts() };
});

result.errors = errors;
const checks = [];
const check = (ok, what) => { checks.push({ ok, what }); console.log(ok ? 'ok  ' : 'FAIL', what); };
const R = result.release;
check(R.emptyBuilt === 0 && R.groupsWhenReleased.every((n) => n === 0), `releaseAll leaves no airport parts (groups ${R.groupsWhenReleased.join('/')})`);
check(R.released.geometries < R.before.geometries && R.released.textures < R.before.textures, `released: geometries ${R.before.geometries} -> ${R.released.geometries}, textures ${R.before.textures} -> ${R.released.textures}`);
check(R.rebuilt.geometries === R.before.geometries && R.rebuilt.textures === R.before.textures, `rebuilt: geometries ${R.rebuilt.geometries}, textures ${R.rebuilt.textures} (were ${R.before.geometries}, ${R.before.textures})`);
check(result.back.built.join() === result.start.built.join(), `back at Gimpo the same airports are built (${result.back.built.join(', ')})`);
// (renderer.info.memory counts what has been drawn: the boot's view drew a few objects the final doesn't.)
check(result.back.mem.geometries <= result.start.mem.geometries && result.back.mem.textures <= result.start.mem.textures, `back at Gimpo, no more than at the start: geometries ${result.start.mem.geometries} -> ${result.back.mem.geometries}, textures ${result.start.mem.textures} -> ${result.back.mem.textures}`);
check(!errors.length, `no console errors (${errors.length})`);
for (const L of result.legs) console.log(`${L.name}: ${L.km} km, ${L.frames} frames, mean ${L.meanMs} ms, worst ${L.worstMs} ms (the airport set's part of it ${L.worstAt?.setMs} ms; its own worst ${L.worstSetMs} ms); built on the way ${L.seenBuilt.join(', ')}; at the end ${L.builtAtEnd.join(', ')}; memory ${JSON.stringify(L.mem)}`);
for (const f of result.finals) console.log(`final ${f.icao} ${f.ident}: ${f.calls} calls, ${(f.triangles / 1000).toFixed(0)}k triangles, worst frame ${f.worstMs} ms`);
for (const b of result.builds) console.log(`built ${b.id}: ${b.ms} ms in ${b.slices} slices, the longest ${b.worstSliceMs} ms, ${b.worstSliceName} (${b.parts.join(', ')})`);
writeFileSync(`${OUT}/browser-airport-set.json`, JSON.stringify({ ...result, checks }, null, 2));
await browser.close();
process.exit(checks.every((c) => c.ok) ? 0 : 1);
