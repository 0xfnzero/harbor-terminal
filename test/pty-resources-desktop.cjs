const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  if (process.platform !== 'darwin') { console.log('SKIP macOS PTY resource regression'); return; }
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'harbor-pty-resources-'));
  let app;
  try {
    app = await electron.launch({ ...(process.env.HARBOR_EXECUTABLE ? { executablePath: process.env.HARBOR_EXECUTABLE } : {}), args: [...(process.env.HARBOR_EXECUTABLE ? [] : ['.']), `--user-data-dir=${profile}`], env: { ...process.env, ZDOTDIR: profile, SHELL: '/bin/zsh', HARBOR_DEV: '0' } });
    const page = await app.firstWindow(); page.setDefaultTimeout(15000);
    await page.getByRole('button', { name: 'New local terminal', exact: true }).waitFor();
    await app.evaluate(({ app }) => { global.ptyTestRequire = process.mainModule.require('node:module').createRequire(app.getAppPath() + '/package.json'); });
    const counts = () => app.evaluate(() => {
      const cp = process.mainModule.require('node:child_process');
      const output = cp.execFileSync('/usr/sbin/lsof', ['-p', String(process.pid), '-Fn'], { encoding: 'utf8' });
      return output.split('\n').filter(line => /^n\/dev\/(ptmx|ttys)/.test(line)).length;
    });
    const baseline = await counts();
    // node-pty can emit exit from its EIO handler before the stream's async
    // descriptor close completes. Allow that close to settle, never a leak.
    const assertReleased = async message => {
      const deadline = Date.now() + 3000;
      let actual = await counts();
      while (actual !== baseline && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 50));
        actual = await counts();
      }
      assert.equal(actual, baseline, message);
    };
    // More than the system's 511-PTY limit over time, without holding them at once.
    for (let batch = 0; batch < 30; batch++) {
      await app.evaluate(async () => {
        const pty = global.ptyTestRequire('node-pty');
        for (let i = 0; i < 20; i++) {
          await new Promise((resolve, reject) => {
            const child = pty.spawn('/bin/sh', ['-c', 'printf PTY_OK'], { cwd: '/tmp', env: { PATH: '/usr/bin:/bin' } });
            let output = '';
            const timer = setTimeout(() => { child.kill(); reject(new Error('PTY exit timeout')); }, 5000);
            child.onData(data => output += data);
            child.onExit(({ exitCode }) => { clearTimeout(timer); exitCode === 0 && output.includes('PTY_OK') ? resolve() : reject(new Error('PTY command failed')); });
          });
        }
      });
      await assertReleased(`PTY descriptors leaked after ${(batch + 1) * 20} exits`);
    }
    // Exercise the native failure path without modifying installed helper files.
    const errors = await app.evaluate(() => {
      const { module: native } = global.ptyTestRequire('node-pty/lib/utils').loadNativeModule('pty');
      const errors = [];
      for (let i = 0; i < 100; i++) {
        try { native.fork('/bin/sh', [], ['PATH=/usr/bin:/bin'], '/tmp', 80, 24, -1, -1, true, '/nonexistent-harbor-test/spawn-helper', () => {}); }
        catch (e) { errors.push(e.message); }
      }
      return errors;
    });
    assert.equal(errors.length, 100);
    assert.match(errors[0], /errno=2/);
    await assertReleased('PTY descriptors leaked after spawn failure');
    await page.evaluate(() => { window.ptyTestOutput = ''; window.harbor.onEvent(e => { if (e.type === 'data') window.ptyTestOutput += e.data; }); });
    // Exercise actual tab creation and closure, not only the native module.
    for (let i = 0; i < 20; i++) {
      await page.getByRole('button', { name: 'New local terminal', exact: true }).click();
      await page.locator('.terminal-pane.active .xterm-helper-textarea').waitFor();
      await page.getByRole('button', { name: 'Close Local terminal', exact: true }).click();
      await page.waitForTimeout(30);
    }
    await assertReleased('PTY descriptors leaked after closing tabs');
    await page.getByRole('button', { name: 'New local terminal', exact: true }).click();
    await page.waitForFunction(() => window.ptyTestOutput.includes('❯'));
    const input = page.locator('.terminal-pane.active .xterm-helper-textarea'); await input.focus();
    await page.keyboard.insertText("printf 'AFTER_STRESS_%s\\n' OK"); await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.ptyTestOutput.includes('AFTER_STRESS_OK'));
    console.log('PASS 600 terminal exits, 100 failed spawns, 20 UI tab closes: zero leaked PTY descriptors; terminal remains usable');
  } finally { if (app) await app.close(); await fs.rm(profile, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
