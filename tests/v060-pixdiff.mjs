// v0.6.0: the pixel diff between two stills (Part 1's "Korea unchanged by the tiles"). Pure node, pngjs from the
// Playwright folder:
//   node tests/v060-pixdiff.mjs a.png b.png [out.png] [--amp 8] [--json]
// Prints the mean absolute difference per channel (R, G, B, in 0-255 levels), the share of pixels whose largest
// channel difference is over 2 and over 16 levels, and the largest difference. out.png: the difference, amplified
// (|a-b| x amp per channel, clamped), on black; the same size as the inputs.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire('/tmp/flight-sim/pw/');
const { PNG } = require('pngjs');

export function pixdiff(a, b) {
  if (a.width !== b.width || a.height !== b.height) throw new Error(`size differs: ${a.width}x${a.height} vs ${b.width}x${b.height}`);
  const n = a.width * a.height, sum = [0, 0, 0], diff = Buffer.alloc(n * 4);
  let over2 = 0, over16 = 0, max = 0, maxAt = -1;
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(a.data[4 * i + c] - b.data[4 * i + c]);
      sum[c] += d; if (d > m) m = d;
      diff[4 * i + c] = d;
    }
    diff[4 * i + 3] = 255;
    if (m > 2) over2++;
    if (m > 16) over16++;
    if (m > max) { max = m; maxAt = i; }
  }
  return {
    width: a.width, height: a.height,
    meanAbs: sum.map((s) => s / n), pctOver2: (100 * over2) / n, pctOver16: (100 * over16) / n,
    max, maxAt: maxAt < 0 ? null : [maxAt % a.width, Math.floor(maxAt / a.width)], diff,
  };
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const argv = process.argv.slice(2), files = [];
  let amp = 8, json = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--amp') amp = parseFloat(argv[++i]);
    else if (argv[i] === '--json') json = true;
    else files.push(argv[i]);
  }
  if (files.length < 2) { console.error('usage: node v060-pixdiff.mjs a.png b.png [out.png] [--amp 8] [--json]'); process.exit(2); }
  const [fa, fb, fo] = files;
  const a = PNG.sync.read(readFileSync(fa)), b = PNG.sync.read(readFileSync(fb));
  const r = pixdiff(a, b);
  if (fo) {
    const o = new PNG({ width: r.width, height: r.height });
    for (let i = 0; i < r.diff.length; i++) o.data[i] = (i & 3) === 3 ? 255 : Math.min(255, r.diff[i] * amp);
    writeFileSync(fo, PNG.sync.write(o));
  }
  const { diff, ...stats } = r;
  if (json) console.log(JSON.stringify({ a: fa, b: fb, out: fo || null, amp, ...stats }));
  else {
    console.log(`${fa}\n  vs ${fb}  (${r.width}x${r.height})`);
    console.log(`  mean abs diff R ${r.meanAbs[0].toFixed(4)}  G ${r.meanAbs[1].toFixed(4)}  B ${r.meanAbs[2].toFixed(4)}`);
    console.log(`  pixels > 2 levels: ${r.pctOver2.toFixed(4)} %   > 16 levels: ${r.pctOver16.toFixed(4)} %   max ${r.max}${r.maxAt ? ` at ${r.maxAt.join(',')}` : ''}`);
    if (fo) console.log(`  diff image (x${amp}): ${fo}`);
  }
}
