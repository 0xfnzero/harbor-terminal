require('../electron/locale.cjs').setLanguage('zh-CN');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { generateKeyPairSync } = require('node:crypto');
const { Server, utils } = require('ssh2');
const pty = require('node-pty');
const { validateServer, sshArgs } = require('../electron/core.cjs');
const { platformTools } = require('../electron/transport.cjs');

test('real SSH authenticates with encrypted PEM plus a second password, and password-only', { timeout: 25000 }, async () => {
  const keyPass = 'fixture-key-passphrase';
  const password = 'fixture-account-password';
  const encrypted = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem', cipher: 'aes-256-cbc', passphrase: keyPass }, publicKeyEncoding: { type: 'spki', format: 'pem' } }).privateKey;
  const parsedKey = utils.parseKey(encrypted, keyPass);
  const hostKey = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } }).privateKey;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'harbor-auth-'));
  const file = path.join(dir, 'aws style.pem');
  await fs.writeFile(file, encrypted, { mode: 0o600 });
  const clients = new Set();
  const sequence = [];
  let passwordOnly = false;
  const fixture = new Server({ hostKeys: [hostKey] }, client => {
    clients.add(client);
    client.on('error', () => {});
    client.on('close', () => clients.delete(client));
    let publicKeyAccepted = false;
    client.on('authentication', ctx => {
      if (ctx.method === 'publickey' && !passwordOnly) {
        if (!ctx.signature) return ctx.accept(); // OpenSSH public-key query, not login acceptance.
        if (parsedKey.verify(ctx.blob, ctx.signature, ctx.hashAlgo) !== true) return ctx.reject();
        publicKeyAccepted = true;
        sequence.push('signed-publickey');
        return ctx.reject(['password'], true); // Server requires the second factor.
      }
      if (ctx.method === 'password' && ctx.password === password && (passwordOnly || publicKeyAccepted)) {
        sequence.push('password'); return ctx.accept();
      }
      ctx.reject(passwordOnly ? ['password'] : ['publickey']);
    });
    client.on('ready', () => client.on('session', accept => {
      const session = accept();
      session.on('pty', accept => accept());
      session.on('shell', accept => { const stream = accept(); stream.write('AUTH_SUCCESS\r\n'); stream.exit(0); stream.end(); });
    }));
  });
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
  let terminal;
  try {
    const connect = async authMode => {
      const config = validateServer({ name: 'auth-fixture', host: '127.0.0.1', port: fixture.address().port, username: 'fixture-user', identityFile: file, persistent: false, authMode });
      const nullFile = process.platform === 'win32' ? 'NUL' : '/dev/null';
      const args = ['-F', nullFile, '-o', `UserKnownHostsFile=${nullFile}`, '-o', 'StrictHostKeyChecking=no', ...sshArgs(config, 'unused')];
      let output = '';
      let keyPrompt = false;
      let passwordPrompt = false;
      const result = await new Promise((resolve, reject) => {
        terminal = pty.spawn(platformTools().ssh, args, { name: 'xterm-256color', cols: 100, rows: 24, cwd: dir, env: { ...process.env, LC_ALL: 'C', TERM: 'xterm-256color', SSH_AUTH_SOCK: '' } });
        const timeout = setTimeout(() => { terminal.kill(); reject(new Error('SSH authentication timed out')); }, 10000);
        terminal.onData(data => {
          output += data;
          if (!keyPrompt && /[Pp]assphrase for key[^\n]*:\s*$/.test(output)) { keyPrompt = true; terminal.write(keyPass + '\r'); }
          else if (!passwordPrompt && /[Pp]assword:\s*$/.test(output)) { passwordPrompt = true; terminal.write(password + '\r'); }
        });
        terminal.onExit(event => { clearTimeout(timeout); terminal = null; resolve(event.exitCode); });
      });
      assert.equal(result, 0);
      assert.match(output, /AUTH_SUCCESS/);
      return { keyPrompt, passwordPrompt };
    };
    assert.deepEqual(await connect('key-password'), { keyPrompt: true, passwordPrompt: true });
    assert.deepEqual(sequence, ['signed-publickey', 'password']);
    passwordOnly = true;
    sequence.length = 0;
    assert.deepEqual(await connect('password'), { keyPrompt: false, passwordPrompt: true });
    assert.deepEqual(sequence, ['password']);
  } finally {
    terminal?.kill();
    for (const client of clients) client.end();
    await new Promise(resolve => fixture.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  }
});
