// A picture of the live page (HUD, menus, score card) that headless Chromium can actually
// take. Once the game is up, SwiftShader WebGL keeps the GPU process so busy that captures of
// any page in that browser hang, so: render one frame, swap every canvas for an image of it,
// drop the scripts, open the copy in a second page and capture that. Throttle the game's
// frames first (see ui-shots.cjs), or pause it, so the GPU isn't still busy.
module.exports = async function snap(page, browser, path, base, viewport) {
  const html = await page.evaluate((b) => {
    if (window.__fs) window.__fs.renderOnce();
    const live = [...document.querySelectorAll('canvas')];
    const urls = live.map((c) => { try { return c.toDataURL('image/png'); } catch { return ''; } });
    const clone = document.documentElement.cloneNode(true);
    [...clone.querySelectorAll('canvas')].forEach((c, i) => {
      const img = document.createElement('img');
      img.src = urls[i]; if (c.id) img.id = c.id; if (c.className) img.className = c.className;
      const r = live[i].getBoundingClientRect();
      img.setAttribute('style', (live[i].getAttribute('style') || '') + `;display:block;width:${r.width}px;height:${r.height}px`);
      c.replaceWith(img);
    });
    clone.querySelectorAll('script').forEach((s) => s.remove());
    const lv = [...document.querySelectorAll('input')], cv = [...clone.querySelectorAll('input')];
    cv.forEach((x, i) => x.setAttribute('value', lv[i].value));   // sliders keep their live values
    const bt = document.createElement('base'); bt.href = b; clone.querySelector('head').prepend(bt);
    return '<!doctype html>' + clone.outerHTML;
  }, base);
  const still = await browser.newPage({ viewport });
  await still.setContent(html, { waitUntil: 'load' });
  await still.waitForTimeout(300);
  await still.screenshot({ path, timeout: 60000 });
  await still.close();
};
