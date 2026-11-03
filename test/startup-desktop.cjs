const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  if (process.platform !== 'darwin') { console.log('SKIP macOS zsh startup fixture'); return; }
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'harbor-startup-ui-'));
  const home = path.join(root, 'home'); await fs.mkdir(home);
  const rc = 'while [[ ! -e "$HOME/allow-start" ]]; do sleep 0.1; done\nexport HARBOR_RC_LOADED=yes\nprintf "NORMAL_READY\\n"\n';
  await fs.writeFile(path.join(home, '.zshrc'), rc);
  let app;
  try {
    app = await electron.launch({ ...(process.env.HARBOR_EXECUTABLE ? { executablePath: process.env.HARBOR_EXECUTABLE } : {}), args: [...(process.env.HARBOR_EXECUTABLE ? [] : ['.']), `--user-data-dir=${path.join(root, 'profile')}`], env: { ...process.env, HOME: home, ZDOTDIR: home, SHELL: '/bin/zsh', HARBOR_DEV: '0' } });
    const page = await app.firstWindow(); page.setDefaultTimeout(12000);
    await app.evaluate(() => {
      const pty = process.mainModule.require('node-pty');
      const spawn = pty.spawn; global.startupPids = [];
      pty.spawn = (...args) => { const child = spawn(...args); global.startupPids.push(child.pid); return child; };
    });
    await page.evaluate(() => { window.startupOutput = ''; window.harbor.onEvent(e => { if (e.type === 'data') window.startupOutput += e.data; }); });
    await page.getByRole('button', { name: 'Open local terminal', exact: true }).click();
    await page.getByText('Waiting for shell output…', { exact: true }).waitFor();
    await page.getByText('No terminal output yet', { exact: true }).waitFor();
    const originalPid = await app.evaluate(() => global.startupPids[0]);
    await page.getByRole('button', { name: 'Keep waiting', exact: true }).click();
    assert.equal(await page.locator('.terminal-startup').count(), 0);
    await page.getByRole('button', { name: 'Temporary terminal', exact: true }).click();
    await page.getByRole('tab', { name: 'Temporary terminal', exact: true }).waitFor();
    await page.waitForFunction(() => window.startupOutput.includes('$ '));
    const input = page.locator('.terminal-pane.active .xterm-helper-textarea'); await input.focus();
    await page.keyboard.insertText("printf 'RECOVERY_%s_%s\\n' OK \"${HARBOR_RC_LOADED:-skipped}\""); await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.startupOutput.includes('RECOVERY_OK_skipped'));
    const pids = await app.evaluate(() => { for (const pid of global.startupPids) process.kill(pid, 0); return global.startupPids; });
    assert.equal(pids[0], originalPid); assert.equal(pids.length, 2); assert.notEqual(pids[0], pids[1]);
    await fs.writeFile(path.join(home, 'allow-start'), '');
    await page.waitForFunction(() => window.startupOutput.includes('NORMAL_READY'));
    await page.getByRole('tab', { name: 'Local terminal', exact: true }).click();
    assert.equal(await page.locator('.terminal-startup').count(), 0);
    await input.focus(); await page.keyboard.insertText("printf 'ORIGINAL_%s\\n' ALIVE"); await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.startupOutput.includes('ORIGINAL_ALIVE'));
    assert.equal(await fs.readFile(path.join(home, '.zshrc'), 'utf8'), rc);
    const invalid = await page.evaluate(async () => {
      try { await window.harbor.openSession({ id: crypto.randomUUID(), serverId: 'test', localMode: 'clean' }); return false; } catch { return true; }
    });
    assert.equal(invalid, true);
    console.log('PASS delayed startup hint, dismissal, profile-free recovery, original-shell preservation and input validation');
  } finally { if (app) await app.close(); await fs.rm(root, { recursive: true, force: true }); }
})().catch(e => { console.error(e); process.exitCode = 1; });
