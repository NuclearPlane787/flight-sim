// v0.5.7: the home page's line art (src/ui/line-art.js) on its dev page, from the cloud (headless Chromium,
// SwiftShader). Checks the page loads with no console errors and draws every path, then saves pictures: the whole
// skyline at 1:1 in crops of about 1000 px (each landmark whole in one of them), the seam between two copies, the
// half-size strip (two pictures), and the icons.
//   python3 tests/cloud/serve.py <GameDump folder> 8765 &
//   node tests/cloud/v057-line-art.cjs outDir        (FS_ROOT, default http://127.0.0.1:8765/games/)
const { chromium } = require('playwright');
const ROOT = process.env.FS_ROOT || 'http://127.0.0.1:8765/games/';
const out = process.argv[2] || 'v057-line-art';
require('fs').mkdirSync(out, { recursive: true });
const ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra !== '' ? ` (${extra})` : ''}`); if (!ok) fails++; };
(async () => {
  const browser = await chromium.launch({ args: ARGS });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(ROOT + 'flight-sim/tests/dev-line-art.html');
  await page.waitForSelector('body[data-ready="1"]', { timeout: 60000 });
  await page.waitForTimeout(300);
  const info = await page.evaluate(() => {
    const strips = [...document.querySelectorAll('svg.strip')].map((s) => {
      const r = s.getBoundingClientRect();
      return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height, paths: s.querySelectorAll('path').length };
    });
    const icons = document.querySelector('[data-o="icons"]').getBoundingClientRect();
    // every path has a box (it parsed and drew something)
    const empty = [...document.querySelectorAll('svg path')].filter((p) => { const b = p.getBBox(); return !(b.width > 0 || b.height > 0); }).length;
    return { la: window.__lineArt, strips, icons: { x: icons.left + scrollX, y: icons.top + scrollY, w: icons.width, h: icons.height }, empty };
  });
  const { la } = info;
  check('the page loads with no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  check('both strips drawn, two copies each', info.strips.length === 2 && info.strips[0].paths === info.strips[1].paths && info.strips[0].paths > 100, info.strips.map((s) => s.paths).join('/'));
  check('every path draws something', info.empty === 0, `${info.empty} empty`);
  console.log(`skyline ${la.width} × ${la.height}, ${la.landmarks.length} landmarks, ${(la.bytes / 1024).toFixed(1)} KB of path data`);

  const shot = async (name, clip) => {
    try {
      await page.screenshot({ path: `${out}/${name}.png`, fullPage: true, clip: { x: Math.max(0, Math.round(clip.x)), y: Math.round(clip.y), width: Math.round(clip.w), height: Math.round(clip.h) } });
      console.log('shot', name);
    } catch (err) { console.log('no picture', name, String(err).slice(0, 120)); fails++; }
  };
  // 1:1 crops of about 1000 px, cut in the gaps between landmarks so each landmark is whole in one
  const s1 = info.strips[0], W = la.width;
  const cuts = [0];
  la.landmarks.forEach((l, i) => { if (i > 0 && l.x1 - cuts[cuts.length - 1] > 1000) cuts.push(Math.round((la.landmarks[i - 1].x1 + l.x0) / 2)); });
  cuts.push(W);
  for (let i = 0; i < cuts.length - 1; i++) await shot(`v057-line-art-strip-${i + 1}`, { x: s1.x + cuts[i], y: s1.y, w: cuts[i + 1] - cuts[i], h: s1.h });
  await shot('v057-line-art-seam', { x: s1.x + W - 600, y: s1.y, w: 1200, h: s1.h });
  // the half-size strip: one copy and a bit past the seam, in two pictures of about 1000 px
  const s2 = info.strips[1], hw = Math.ceil((W / 2 + 60) / 2);
  await shot('v057-line-art-half-1', { x: s2.x, y: s2.y, w: hw, h: s2.h });
  await shot('v057-line-art-half-2', { x: s2.x + hw, y: s2.y, w: hw, h: s2.h });
  await shot('v057-line-art-icons', { x: info.icons.x - 8, y: info.icons.y - 8, w: info.icons.w + 16, h: info.icons.h + 16 });
  await browser.close();
  console.log(fails ? `${fails} FAILED` : 'all ok');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
