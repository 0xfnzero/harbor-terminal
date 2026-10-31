// Real OpenSSH + local SSH fixture; package tools are isolated stubs, never host installers.
if (process.platform === 'win32') { console.log('SKIP Unix tmux SSH fixture on Windows'); process.exit(0); }
const { _electron: electron } = require('playwright');
const { Server } = require('ssh2');
const { generateKeyPairSync } = require('node:crypto');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harbor-tmux-ui-'));
  const bin = path.join(root, 'bin'); fs.mkdirSync(bin);
  const fixture = (name, text) => fs.writeFileSync(path.join(bin, name), '#!/bin/sh\n' + text, { mode: 0o700 });
  fixture('sh', 'exec /bin/sh "$@"');
  fixture('id', 'echo 0');
  // Keep this script separate from the installer: verify installed binaries are used afterwards.
  fixture('apt-get', `if [ "$1" = install ]; then /bin/cp "$FIXTURE/tmux-source" "$FIXTURE/bin/tmux"; /bin/chmod 700 "$FIXTURE/bin/tmux"; fi`);
  fs.writeFileSync(path.join(root, 'tmux-source'), '#!/bin/sh\nif [ "$1" = -V ]; then echo "tmux fixture"; else echo PERSISTENT_SESSION_CONNECTED; fi\n');
  const key = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } }).privateKey;
  const clients = new Set(), commands = [], usernames = [];
  const server = new Server({ hostKeys: [key] }, client => {
    clients.add(client); client.on('error', () => {}); client.on('close', () => clients.delete(client));
    client.on('authentication', ctx => { usernames.push(ctx.username); ctx.accept(); });
    client.on('ready', () => client.on('session', accept => {
      const session = accept(); session.on('pty', accept => accept());
      session.on('exec', (accept, reject, info) => {
        commands.push(info.command); const stream = accept();
        const child = spawn('/bin/sh', ['-c', info.command], { env: { PATH: bin, FIXTURE: root } });
        child.stdout.on('data', data => stream.write(data)); child.stderr.on('data', data => stream.stderr.write(data));
        stream.on('data', data => child.stdin.write(data));
        child.on('exit', code => { stream.exit(code || 0); stream.end(); });
        stream.on('close', () => child.kill());
      });
    }));
  });
  let app;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    app = await electron.launch({ args: ['.', `--user-data-dir=${path.join(root, 'profile')}`], env: { ...process.env, HARBOR_DEV: '0' } });
    // Avoid modifying the user's known_hosts for this disposable loopback SSH fixture.
    await app.evaluate(() => {
      const pty = process.mainModule.require(process.cwd() + '/node_modules/node-pty'); const spawn = pty.spawn;
      pty.spawn = (file, args, options) => spawn(file, file === '/usr/bin/ssh' ? ['-F', '/dev/null', '-o', 'UserKnownHostsFile=/dev/null', '-o', 'StrictHostKeyChecking=no', ...args] : args, options);
    });
    const page = await app.firstWindow(); page.setDefaultTimeout(15000);
    await page.evaluate(async port => { await window.harbor.saveServer({ name: 'Tmux fixture', host: '127.0.0.1', port, username: 'developer', persistent: false }); }, server.address().port);
    await page.reload();
    const select = async (label, value) => { await page.getByRole('combobox', { name: label, exact: true }).click(); await page.locator(`[role=option][data-value="${value}"]`).click(); };
    const open = async () => { await page.getByRole('button', { name: 'Components', exact: true }).click(); await select('Choose component', 'tmux'); };
    await open();
    assert.equal(await page.getByRole('combobox', { name: 'Install location', exact: true }).count(), 0);
    await page.getByRole('note').filter({ hasText: 'server only' }).waitFor();
    await select('Choose component', 'mosh');
    await select('Install location', 'local');
    await select('Choose component', 'tmux');
    assert.equal(await page.getByRole('combobox', { name: 'Install location', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Start installation', exact: true }).isEnabled(), false);
    assert.equal(await page.getByRole('checkbox', { name: /UDP/ }).count(), 0);
    await page.getByRole('button', { name: 'Check status', exact: true }).click();
    await page.getByRole('heading', { name: 'tmux is not installed', exact: true }).waitFor();
    await page.getByRole('tab', { name: 'tmux · Tmux fixture', exact: true }).waitFor();
    assert.equal(fs.existsSync(path.join(bin, 'tmux')), false);
    await open();
    await page.getByRole('textbox', { name: 'Installation admin account', exact: true }).fill('root');
    await page.getByRole('checkbox', { name: 'I understand the location and changes, and allow installation' }).check();
    await page.getByRole('button', { name: 'Start installation', exact: true }).click();
    await page.getByRole('heading', { name: 'Component ready', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Enable persistence and connect', exact: true }).click();
    await page.waitForFunction(async () => (await window.harbor.listServers())[0].persistent);
    await page.getByRole('button', { name: 'Reconnect', exact: true }).waitFor();
    const saved = await page.evaluate(async () => (await window.harbor.listServers())[0]);
    assert.equal(saved.username, 'developer'); assert.ok(usernames.includes('root'));
    assert.equal(usernames.at(-1), 'developer');
    assert.match(commands.at(-1), /tmux new-session -A/);
    assert.ok(commands.slice(0, 2).every(command => !/ufw|firewall-cmd/.test(command)));
    const beforeReconnect = commands.length;
    await page.getByRole('button', { name: 'Reconnect', exact: true }).click();
    const deadline = Date.now() + 10000;
    while (commands.length === beforeReconnect && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(commands.length, beforeReconnect + 1);
    await page.getByRole('button', { name: 'Reconnect', exact: true }).waitFor();
    assert.equal(commands.at(-1), commands.at(-2), 'reconnect retains the tmux session name');
    console.log('PASS tmux UI check, consent, SSH installation, original-account persistent connection and reconnect target');
  } finally {
    if (app) await app.close(); for (const client of clients) client.destroy();
    await new Promise(resolve => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
