const { _electron: electron } = require('playwright');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  for (const cleanup of ['normal', 'delayed', 'stalled']) {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'harbor-quit-ui-'));
    let app, exited = false;
    try {
      app = await electron.launch({ args: ['.', `--user-data-dir=${profile}`], env: { ...process.env, HARBOR_DEV: '0' } });
      const page = await app.firstWindow();
      await page.evaluate(() => window.harbor.saveServer({ name: 'Quit fixture', host: 'example.invalid', username: 'fixture' }));
      await page.getByRole('button', { name: 'Open local terminal', exact: true }).click();
      if (cleanup !== 'normal') await app.evaluate((_, mode) => {
        const { ProtectedClipboard } = process.mainModule.require(process.cwd() + '/electron/protected-clipboard.cjs');
        global.quitCleanupCalls = 0;
        ProtectedClipboard.prototype.clear = () => {
          ++global.quitCleanupCalls;
          return mode === 'stalled' ? new Promise(() => {}) : new Promise(resolve => setTimeout(resolve, 700));
        };
      }, cleanup);
      let timer;
      const exit = new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`Quit did not exit: ${cleanup}`)), 5000);
        app.process().once('exit', code => { exited = true; clearTimeout(timer); resolve(code); });
      });
      await app.evaluate(({ app, Menu }) => {
        setTimeout(() => {
          if (process.platform === 'darwin') Menu.sendActionToFirstResponder('terminate:'); else app.quit();
        }, 30);
      });
      if (cleanup !== 'normal') {
        await page.waitForTimeout(150);
        // The initial canceled quit must not dispose the vault under a live UI.
        assert.equal((await page.evaluate(() => window.harbor.listServers()))[0].name, 'Quit fixture');
        await app.evaluate(({ app }) => app.quit());
        assert.equal(await app.evaluate(() => global.quitCleanupCalls), 1, 'repeat quit shares pending cleanup');
      }
      assert.equal(await exit, 0);
      console.log(`PASS native quit exits with ${cleanup} clipboard cleanup and an active local terminal`);
    } finally {
      if (app && !exited) await app.close();
      fs.rmSync(profile, { recursive: true, force: true });
    }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
