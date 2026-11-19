// v0.5.3: the Boeings' models following a design's airframe (src/widebody.js, def.geo.AIRFRAME), at the sliders'
// limits, in tests/dev-widebody.html on this Mac's GPU. Each design is one picture of four panels: from above, the
// side and the front (narrow lenses from far off, near orthographic), and a three-quarter view from behind with the
// wing bent, the slats, flaps and gear down.
//   python3 tools/cpu-guard.py -- node tests/browser-widebody-airframe.mjs [--type b777-300er] [--close] [design names…]
// --close: close-ups instead (the forward plug's windows, the tail's roots, a pylon, the fairing and gear from below).
// Saves "Claude outputs/flight-sim/v053-<787|777>-<design>.png".

import { chromium } from '/tmp/flight-sim/pw/node_modules/playwright/index.mjs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { newDesign, defaultAirframe } from '../src/sim/designs.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, '../../../Claude outputs/flight-sim');
const BASE = process.env.FS_URL || 'http://127.0.0.1:8014/games/flight-sim/';
const argv = process.argv.slice(2);
const typeAt = argv.indexOf('--type');
const TYPES = typeAt >= 0 ? [argv.splice(typeAt, 2)[1]] : ['b787-9', 'b777-300er'];
const W = (span, chord, sweep, dihedral) => ({ span, chord, sweep, dihedral });
const DESIGNS = {
  // the brief's test design
  brief: { tail: 1.6, fin: 0.6, plugFwd: 6, plugAft: -4, wingL: W(1.3, 0.8, 8, 8), mirror: true },
  // every slider at its top
  big: { tail: 1.6, fin: 1.6, plugFwd: 6, plugAft: 6, wingL: W(1.3, 1.3, 8, 8), mirror: true },
  // every slider at its bottom
  small: { tail: 0.6, fin: 0.6, plugFwd: -4, plugAft: -4, wingL: W(0.8, 0.8, -8, -3), mirror: true },
  // one wing long and swept back, the other short and swept forward
  asym: { tail: 1, fin: 1, plugFwd: 0, plugAft: 0, wingL: W(1.3, 1, 8, 8), wingR: W(0.8, 1.3, -8, -3), mirror: false },
};
const closeAt = argv.indexOf('--close'), CLOSE = closeAt >= 0;
if (CLOSE) argv.splice(closeAt, 1);
const names = argv.length ? argv : Object.keys(DESIGNS);
const short = { 'b787-9': '787', 'b777-300er': '777' };

const browser = await chromium.launch({ channel: 'chrome', headless: !!process.env.FS_HEADLESS, args: ['--mute-audio', ...(process.env.FS_HEADLESS ? ['--use-angle=metal', '--ignore-gpu-blocklist'] : []), '--window-size=1440,960'] });
let fails = 0;
try {
  for (const type of TYPES) {
    for (const name of names) {
      const af0 = defaultAirframe(type), o = DESIGNS[name];
      const af = { ...af0, ...o, wingL: { ...af0.wingL, ...o.wingL } };
      af.wingR = o.mirror === false ? { ...af0.wingR, ...o.wingR } : { ...af.wingL };
      const design = { ...newDesign(type), airframe: af };
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const errors = [];
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto(BASE + 'tests/dev-widebody.html?design=' + encodeURIComponent(JSON.stringify(design)));
      await page.waitForFunction(() => window.dev?.ready, null, { timeout: 30000 });
      if (CLOSE) {
        const { designDef } = await import('../src/sim/designs.js');
        const M = designDef(design).geo.AIRFRAME;
        await page.evaluate(([c, t]) => { window.__close = true; window.__cutX = c; window.__tailX = t; }, [M.cuts.fwd + Math.max(0, M.plugFwd) / 2, M.bodyX(M.cuts.aft - 20)]);
      }
      const png = await page.evaluate(async () => {
        const dev = window.dev, d = dev.defaults, G = dev.geo;
        const L = (G.NOSE_X - G.TAIL_X) * 1.25;
        dev.shot(true);
        const clean = () => dev.set({ slatDeg: 0, flapDeg: 0, gearPos: 1, gearDoors: 0, gearCompression: { nose: d.nose, left: d.main, right: d.main } });
        const wait = () => new Promise((r) => setTimeout(r, 250));
        const panels = [];
        clean(); dev.flex(0);
        dev.hideGround(true); dev.look(0, 89.5, L / (2 * Math.tan(5 * Math.PI / 180)), [0, 0, 0], 10); await wait(); panels.push(dev.png());
        dev.hideGround(false); dev.look(90, 0.5, L / (2 * Math.tan(5 * Math.PI / 180)), [0, 2, 0], 10); await wait(); panels.push(dev.png());
        dev.look(0, 1, L / (2 * Math.tan(5 * Math.PI / 180)) * 1.2, [0, 2, 0], 10); await wait(); panels.push(dev.png());
        dev.set({ slatDeg: 30, flapDeg: 30, gearPos: 1, gearDoors: 0 }); dev.flex(3);
        dev.look(150, 22, 95, [-6, 0, 8], 40); await wait(); panels.push(dev.png());
        if (window.__close) {
          // close-ups: the forward plug's windows, the tail's roots, the engine's pylon, the fairing and gear from below
          panels.length = 0; dev.flex(0); clean();
          const nac = dev.nacelles[0], gx = d && -4;
          dev.look(90, 2, 26, [window.__cutX, 0.5, 0], 40); await wait(); panels.push(dev.png());
          dev.look(125, 14, 30, [window.__tailX, 3, 0], 40); await wait(); panels.push(dev.png());
          dev.look(35, 4, 16, [nac.x, nac.z + 0.5, nac.y], 40); await wait(); panels.push(dev.png());
          dev.hideGround(true); dev.look(-30, -25, 34, [gx, -2, 2], 40); await wait(); panels.push(dev.png());
        }
        const imgs = await Promise.all(panels.map((u) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = u; })));
        const c = document.createElement('canvas'); c.width = 1920; c.height = 1200;
        const g = c.getContext('2d');
        imgs.forEach((im, k) => g.drawImage(im, (k % 2) * 960, Math.floor(k / 2) * 600, 960, 600));
        g.fillStyle = '#000'; g.font = '22px system-ui';
        (window.__close ? ['the forward plug', 'the tail', 'the pylon', 'below: fairing, gear'] : ['above', 'side', 'front', 'bent 3 m, flaps 30, gear down']).forEach((t, k) => g.fillText(t, (k % 2) * 960 + 12, Math.floor(k / 2) * 600 + 28));
        return c.toDataURL('image/png');
      });
      const file = path.join(OUT, `v053-${short[type]}-${name}${CLOSE ? '-close' : ''}.png`);
      const { writeFile } = await import('node:fs/promises');
      await writeFile(file, Buffer.from(png.split(',')[1], 'base64'));
      console.log(type, name, file, errors.length ? 'ERRORS ' + errors.join(' | ') : 'console clean');
      if (errors.length) fails++;
      await page.close();
    }
  }
} finally {
  await browser.close();
}
process.exitCode = fails ? 1 : 0;
