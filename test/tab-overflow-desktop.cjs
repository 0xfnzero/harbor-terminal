const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'harbor-tab-overflow-'));
  let app;
  try {
    app = await electron.launch({ ...(process.env.HARBOR_EXECUTABLE ? { executablePath: process.env.HARBOR_EXECUTABLE } : {}), args: [...(process.env.HARBOR_EXECUTABLE ? [] : ['.']), `--user-data-dir=${profile}`], env: { ...process.env, ZDOTDIR: profile, HARBOR_DEV: '0' } });
    const page = await app.firstWindow();
    await page.getByRole('button', { name: 'New local terminal', exact: true }).waitFor();
    for (let i = 0; i < 12; i++) await page.getByRole('button', { name: 'New local terminal', exact: true }).click();
    const visible = () => page.waitForFunction(() => {
      const view = document.querySelector('.tabs').getBoundingClientRect(), selected = document.querySelector('.tab.selected').getBoundingClientRect();
      return selected.left >= view.left - 1 && selected.right <= view.right + 1;
    });
    await visible();
    await page.getByRole('button', { name: 'Scroll tabs left', exact: true }).click();
    await page.waitForFunction(() => { const el = document.querySelector('.tabs'); return el.scrollLeft < el.scrollWidth - el.clientWidth - 30; });
    await page.locator('.tabs').hover();
    await page.mouse.wheel(0, -3000);
    await page.waitForFunction(() => document.querySelector('.tabs').scrollLeft < 1);
    await page.mouse.wheel(600, 0);
    await page.waitForFunction(() => document.querySelector('.tabs').scrollLeft > 100);
    await page.getByRole('button', { name: 'New local terminal', exact: true }).click();
    await visible();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 720));
    await visible();
    const plus = await page.getByRole('button', { name: 'New local terminal', exact: true }).boundingBox();
    assert.ok(plus.x + plus.width <= await page.evaluate(() => innerWidth));
    for (let i = 0; i < 12; i++) await page.locator('.tab.selected .tab-close').click();
    await page.waitForFunction(() => !document.querySelector('.tab-scroll'));
    await visible();
    console.log('PASS 13 tabs: active reveal, vertical wheel, horizontal trackpad, arrow navigation, resize, fixed new-tab button and overflow removal');
  } finally { if (app) await app.close(); await fs.rm(profile, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
