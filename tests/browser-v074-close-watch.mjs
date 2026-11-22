// v0.7.4, fix 8: tests/pw.mjs's watch on every close. Run twice:
//   node tests/browser-v074-close-watch.mjs            every close returns in time: "closed in time", exit 0
//   FS_CLOSE_MS=1 node tests/browser-v074-close-watch.mjs   every close is "late" at once (the hang, made on purpose): each
//     is logged and returns, the script still prints its last line, and node exits with the code the script set (3).
// Headless, muted. Through the lock and the guard: /tmp/flight-sim/v074/gk.sh br 2 lead/close.txt '^done' node games/flight-sim/tests/browser-v074-close-watch.mjs
import { chromium, CLOSE_MS } from './pw.mjs';

const t0 = Date.now();
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio'] });
const ctx = await browser.newContext({ viewport: { width: 400, height: 300 } });
const page = await ctx.newPage();
await page.goto('about:blank');
const title = await page.evaluate(() => document.readyState);
const page2 = await browser.newPage();
await page.close(); await page2.close(); await ctx.close(); await browser.close();
const forced = CLOSE_MS < 50;
if (forced) process.exitCode = 3;
console.log(`done: the page was ${title}; closes ${forced ? 'made late on purpose (FS_CLOSE_MS=' + CLOSE_MS + ')' : 'in time'}; ${Date.now() - t0} ms`);
