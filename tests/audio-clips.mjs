// Listening clips (v0.2.2): renders the flight phases in tests/dev-audio-render.html's CLIPS
// (idle, take-off, cruise, approach, landing; from the cockpit, the nose and 3rd person)
// through src/audio/synth.js, and saves each as a WAV (and an MP3 if ffmpeg is there).
//
//   node tests/audio-clips.mjs outDir [clip names…]          (E2E_ROOT as in audio-render.mjs)
//   FS_CLOUD=1 E2E_ROOT=http://127.0.0.1:8765/ node tests/audio-clips.mjs outDir   (the cloud container)
// SYNTH=<url relative to tests/> renders another copy of the synth (an older one, to compare).

import { writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const CLOUD = !!process.env.FS_CLOUD;
const { chromium } = CLOUD ? createRequire(import.meta.url)('playwright') : await import('/tmp/flight-sim/pw/node_modules/playwright/index.mjs');
const ROOT = process.env.E2E_ROOT || 'http://localhost:8001/';
const [out = 'clips', ...only] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
let ffmpeg = true;
try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { ffmpeg = false; }

const browser = await chromium.launch(CLOUD ? {} : { channel: 'chrome', headless: false });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(ROOT + 'games/flight-sim/tests/dev-audio-render.html' + (process.env.SYNTH ? '?synth=' + encodeURIComponent(process.env.SYNTH) : ''));
  await page.waitForFunction(() => typeof window.renderClip === 'function', null, { timeout: 30000 });
  const names = only.length ? only : await page.evaluate(() => window.clipNames());
  for (const name of names) {
    const r = await page.evaluate((n) => window.renderClip(n), name);
    const file = `${out}/${name.replace(/^clip-/, '')}.wav`;
    writeFileSync(file, Buffer.from(r.wav, 'base64'));
    if (ffmpeg) execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', file, '-codec:a', 'libmp3lame', '-b:a', '160k', file.replace(/\.wav$/, '.mp3')]);
    console.log(`${name}: ${r.dur} s, ${r.rms.toFixed(1)} dB RMS, peak ${r.peak.toFixed(3)} → ${file}`);
  }
  if (errors.length) { console.log('page errors:', errors); process.exitCode = 1; }
} finally {
  await browser.close();
}
