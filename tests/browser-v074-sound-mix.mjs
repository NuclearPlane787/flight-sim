// v0.7.4, Shane's item 12: with every volume at 100 % the mix is what it was. tests/audio-render.mjs's levels swing by
// a dB or more from run to run (its noise buffers and start points are random), so this renders the same scripted
// flight through this tree's synth.js and the pushed one's with Math.random seeded alike, and compares every
// segment's level, peak and spectrum: they must agree to 0.01 dB.
//
//   node games/flight-sim/tests/browser-v074-sound-mix.mjs [root] [baseSynthUrl]
//   root: http://127.0.0.1:8014/ (the tree under test); baseSynthUrl: /base/games/flight-sim/src/audio/synth.js
// Last line: "mix N of M segments match".

import { chromium } from './pw.mjs';   // (v0.7.4: Playwright with every close on a timeout; the module itself is PW or /tmp/flight-sim/pw's)

const ROOT = process.argv[2] || 'http://127.0.0.1:8014/';
const BASE = process.argv[3] || '/base/games/flight-sim/src/audio/synth.js';
const SEED = `(() => { let s = 12345; Math.random = () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();`;

const browser = await chromium.launch({ channel: 'chrome', headless: !process.argv.includes('--headed'), args: ['--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const out = {};
try {
  for (const [name, synth] of [['tree', null], ['base', BASE]]) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(SEED);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(ROOT + 'games/flight-sim/tests/dev-audio-render.html' + (synth ? '?synth=' + encodeURIComponent(synth) : ''));
    await page.waitForFunction(() => typeof window.runAudio === 'function', null, { timeout: 30000 });
    out[name] = await page.evaluate(() => window.runAudio());
    out[name + 'Wx'] = await page.evaluate(() => window.runWeather());
    if (errors.length) console.log(`${name}: page errors ${errors.join(' | ')}`);
    await Promise.race([ctx.close(), new Promise((r) => setTimeout(r, 5000))]);
  }
} finally {
  await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 8000))]);
}

let ok = 0, all = 0;
const cmp = (label, a, b) => {
  all++;
  const keys = ['rms', 'peak', 'centroid', 'bandDb'];
  const worst = Math.max(...keys.map((k) => (Number.isFinite(a?.[k]) && Number.isFinite(b?.[k]) ? Math.abs(a[k] - b[k]) : (a?.[k] === b?.[k] ? 0 : Infinity))));
  const fine = worst <= 0.01;
  if (fine) ok++;
  console.log(`${fine ? 'same' : 'DIFF'} ${label.padEnd(22)} rms ${a?.rms?.toFixed(3)} vs ${b?.rms?.toFixed(3)} (worst ${worst.toFixed(4)})`);
};
for (const k of Object.keys(out.base.seg)) if (out.base.seg[k] && typeof out.base.seg[k] === 'object' && 'rms' in out.base.seg[k]) cmp(k, out.tree.seg[k], out.base.seg[k]);
const wxT = out.treeWx?.seg || out.treeWx || {}, wxB = out.baseWx?.seg || out.baseWx || {};
for (const k of Object.keys(wxB)) if (wxB[k] && typeof wxB[k] === 'object' && 'rms' in wxB[k]) cmp('wx ' + k, wxT[k], wxB[k]);
console.log(`mix ${ok} of ${all} segments match`);
