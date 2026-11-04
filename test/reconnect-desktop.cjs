const { _electron: electron } = require('playwright');
const { Server } = require('ssh2');
const { generateKeyPairSync } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  if (process.platform !== 'darwin') { console.log('SKIP macOS reconnect resource test'); return; }
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'harbor-reconnect-'));
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  let mode = 'down', app;
  const clients = new Set();
  const server = new Server({ hostKeys: [privateKey] }, client => {
    clients.add(client); client.on('close', () => clients.delete(client)); client.on('error', () => {});
    if (mode === 'down') { client.end(); return; }
    client.on('authentication', ctx => mode === 'auth-failure' ? ctx.reject(['publickey']) : ctx.accept());
    client.on('ready', () => client.on('session', accept => {
      const session = accept(); session.on('pty', accept => accept()); session.on('shell', accept => {
        const stream = accept(); stream.write('RECOVERY_CONNECTED\r\n'); stream.on('data', () => stream.write('REMOTE_INPUT_OK\r\n'));
      });
    }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    app = await electron.launch({ ...(process.env.HARBOR_EXECUTABLE ? { executablePath: process.env.HARBOR_EXECUTABLE } : {}), args: [...(process.env.HARBOR_EXECUTABLE ? [] : ['.']), `--user-data-dir=${profile}`], env: { ...process.env, ZDOTDIR: profile, SHELL: '/bin/zsh', HARBOR_DEV: '0' } });
    const page = await app.firstWindow(); page.setDefaultTimeout(15000);
    await page.getByRole('button', { name: 'New local terminal', exact: true }).waitFor();
    await app.evaluate(({ app }, profile) => {
      const req = process.mainModule.require('node:module').createRequire(app.getAppPath() + '/package.json');
      const pty = req('node-pty'), spawn = pty.spawn;
      pty.spawn = (file, args, options) => spawn(file, file === '/usr/bin/ssh' ? ['-F', '/dev/null', '-o', `UserKnownHostsFile=${profile}/known_hosts`, '-o', 'StrictHostKeyChecking=no', '-o', 'BatchMode=yes', ...args] : args, options);
      const timeout = global.setTimeout;
      // Speed up only Harbor's reconnect timer, retaining the real SSH process.
      global.setTimeout = (fn, delay, ...args) => timeout(fn, typeof fn === 'function' && fn.toString().includes('launch(s)') ? 20 : delay, ...args);
    }, profile);
    await page.evaluate(async port => { await window.harbor.saveServer({ id: 'reconnect-fixture', name: 'Recovery fixture', host: '127.0.0.1', port, username: 'fixture', persistent: false, autoReconnect: true }); }, server.address().port);
    await page.reload();
    await page.getByRole('button', { name: 'New local terminal', exact: true }).waitFor();
    await page.evaluate(() => {
      window.retries = 0; window.output = ''; window.state = ''; window.sessionId = null;
      window.harbor.onEvent(e => {
        window.sessionId = e.id;
        if (e.type === 'data') window.output += e.data;
        if (e.type === 'status') {
          window.state = e.state; window.message = e.message;
          if (e.state === 'retrying' && ++window.retries === 60) window.harbor.pauseRetry(e.id);
        }
      });
    });
    await page.locator('.server-open').filter({ hasText: 'Recovery fixture' }).click();
    await page.waitForFunction(() => window.state === 'paused', { }, { timeout: 30000 });
    const leaked = await app.evaluate(() => process.mainModule.require('node:child_process').execFileSync('/usr/sbin/lsof', ['-p', String(process.pid), '-Fn'], { encoding: 'utf8' }).split('\n').filter(line => /^n\/dev\/(ptmx|ttys)/.test(line)).length);
    assert.equal(leaked, 0, '60 automatic SSH reconnect failures must release all PTYs');
    mode = 'up';
    await page.getByRole('button', { name: 'Reconnect', exact: true }).click();
    await page.waitForFunction(() => window.output.includes('RECOVERY_CONNECTED'));
    await page.locator('.terminal-pane.active .xterm-helper-textarea').focus(); await page.keyboard.type('test');
    await page.waitForFunction(() => window.output.includes('REMOTE_INPUT_OK'));
    // Drop an established connection, fail again, then recover automatically.
    mode = 'down'; for (const client of clients) client.end();
    await page.waitForFunction(() => window.retries >= 65);
    await page.evaluate(() => { window.output = ''; }); mode = 'up';
    await page.waitForFunction(() => window.output.includes('RECOVERY_CONNECTED'));
    // Authentication errors must stop the retry loop rather than spin forever.
    mode = 'auth-failure'; for (const client of clients) client.end();
    await page.waitForFunction(() => window.state === 'error');
    assert.match(await page.evaluate(() => window.message), /SSH authentication failed/);
    const retries = await page.evaluate(() => window.retries);
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => window.retries), retries);
    mode = 'up'; await page.evaluate(() => { window.output = ''; });
    await page.getByRole('button', { name: 'Reconnect', exact: true }).click();
    await page.waitForFunction(() => window.output.includes('RECOVERY_CONNECTED'));
    console.log('PASS 60 failed SSH auto-reconnects without PTY leaks; pause, manual recovery, network recovery, auth-error stop and corrected-auth recovery');
  } finally {
    if (app) await app.close(); for (const client of clients) client.end();
    await new Promise(resolve => server.close(resolve)); await fs.rm(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
