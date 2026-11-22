// v0.7.4 (fix 8, "Found while building v0.7.3"): Playwright for every browser script on the Mac, with a watch on
// every close. A headless Chrome has hung at browser.close() (or at a context's or a page's close) after a script's
// last line most nights since 2026-11-20, the cause not found; in v0.7.3 six such scripts held a guard slot until
// its time cap. tools/check-step.sh's watch stops a hung script from outside; this stops it from inside, for any
// script however it is run:
//   import { chromium } from './pw.mjs';          // in place of '/tmp/flight-sim/pw/node_modules/playwright/index.mjs'
// chromium.launch() returns the browser as Playwright gives it, but its close(), and the close() of every context and
// page made from it, wait CLOSE_MS at most (FS_CLOSE_MS, default 8 s). A close that runs out of time is logged and
// returns, so the script goes on to its own results and exit code; if the process is then still alive 3 s later
// (the hung browser's pipe keeps node up), it exits with the code the script set (process.exitCode, else 0).
// Playwright itself stops the browser it launched when node exits.
// PW (the playwright module's path) is read as before; the cloud checks (tests/cloud/*.cjs) use their own install.
import { pathToFileURL } from 'node:url';

const mod = await import(pathToFileURL(process.env.PW || '/tmp/flight-sim/pw/node_modules/playwright/index.mjs').href);
export const CLOSE_MS = Number(process.env.FS_CLOSE_MS) > 0 ? Number(process.env.FS_CLOSE_MS) : 8000;

let lastResort = null;
function watched(obj, what) {
  if (!obj || obj.__fsWatched) return obj;
  const close = obj.close.bind(obj);
  obj.close = async (...args) => {
    let timer = null;
    const late = new Promise((resolve) => { timer = setTimeout(() => resolve('late'), CLOSE_MS); });
    const r = await Promise.race([close(...args).then(() => 'closed', () => 'closed'), late]);
    clearTimeout(timer);
    if (r === 'late') {
      console.log(`(${what}.close() hadn't returned after ${CLOSE_MS / 1000} s: left behind)`);
      if (!lastResort) { lastResort = setTimeout(() => process.exit(process.exitCode ?? 0), 3000); lastResort.unref(); }
    }
  };
  obj.__fsWatched = true;
  return obj;
}
function watchContext(ctx) {
  watched(ctx, 'context');
  const newPage = ctx.newPage.bind(ctx);
  ctx.newPage = async (...a) => watched(await newPage(...a), 'page');
  return ctx;
}
// A launched browser with its closes watched (exported for a script that launches some other way).
export function watchBrowser(browser) {
  watched(browser, 'browser');
  const newContext = browser.newContext.bind(browser), newPage = browser.newPage.bind(browser);
  browser.newContext = async (...a) => watchContext(await newContext(...a));
  browser.newPage = async (...a) => watched(await newPage(...a), 'page');
  return browser;
}
const wrap = (type) => new Proxy(type, {
  get(target, key) {
    if (key === 'launch') return async (...a) => watchBrowser(await target.launch(...a));
    if (key === 'launchPersistentContext') return async (...a) => watchContext(await target.launchPersistentContext(...a));
    const v = Reflect.get(target, key);
    return typeof v === 'function' ? v.bind(target) : v;
  },
});
export const chromium = wrap(mod.chromium);
export const devices = mod.devices;
