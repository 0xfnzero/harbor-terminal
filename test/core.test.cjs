require('../electron/locale.cjs').setLanguage('zh-CN');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateServer, sshArgs, retryDelay, canRetry } = require('../electron/core.cjs');

const server = (extra) => validateServer({ name: 'Production', host: 'example.com', username: 'deploy', ...extra });
test('validates network targets and rejects option injection', () => {
  for (const host of ['-oProxyCommand=evil', 'user@host', 'host; touch /tmp/evil', 'host\nother', '']) {
    assert.throws(() => server({ host }));
  }
  for (const host of ['2001:db8::1', 'prod-alias', '10.0.0.1']) assert.equal(server({ host }).host, host);
  for (const port of [0, '', 0.5, -1, 65536, 'nope']) assert.throws(() => server({ port }));
  assert.throws(() => server({ username: '-oProxyCommand=evil' }));
});
test('uses argument arrays and a stable, validated remote tmux name', () => {
  const s = server({ identityFile: '/Users/me/keys/my key' });
  const args = sshArgs(s, 'harbor-1234-abcd');
  assert.equal(args[args.indexOf('-i') + 1], '/Users/me/keys/my key');
  assert.equal(args[args.indexOf('--') + 1], 'example.com');
  assert.match(args.at(-1), /exec tmux new-session -A -s 'harbor-1234-abcd'/);
  assert.match(args.at(-1), /exit 69/);
  assert.throws(() => sshArgs(s, "bad'; touch /tmp/evil"));
  assert.deepEqual(sshArgs(s, 'harbor-1234-abcd'), args);
});
test('ordinary SSH does not require tmux and supports ssh config username', () => {
  const args = sshArgs(server({ persistent: false, username: '' }), 'unused');
  assert.equal(args.at(-1), 'example.com');
  assert.ok(!args.includes('-l'));
});
test('only transport/auth SSH failure retries; user exit and missing tmux stop', () => {
  assert.ok(canRetry(server(), 255, false));
  for (const code of [0, 1, 69, 130]) assert.ok(!canRetry(server(), code, false));
  assert.ok(!canRetry(server(), 255, true));
  assert.ok(!canRetry(server({ autoReconnect: false }), 255, false));
  assert.ok(!canRetry(null, 255, false));
  assert.deepEqual(Array.from({ length: 8 }, (_, i) => retryDelay(i)), [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
});
test('network policies migrate old configs and generate explicit bounded SSH options', () => {
  assert.equal(server().networkProfile, 'balanced');
  assert.equal(server().compression, false);
  for (const [profile, interval, count, timeout] of [['balanced', 15, 3, 12], ['tolerant', 15, 12, 30], ['responsive', 5, 3, 10]]) {
    const args = sshArgs(server({ networkProfile: profile, compression: true }), 'harbor-abcd');
    for (const option of [`ServerAliveInterval=${interval}`, `ServerAliveCountMax=${count}`, `ConnectTimeout=${timeout}`, 'TCPKeepAlive=yes', 'Compression=yes']) assert.ok(args.includes(option));
  }
  assert.ok(sshArgs(server(), 'harbor-abcd').includes('Compression=no'));
  for (const networkProfile of ['unknown', '__proto__', 'constructor', 1]) assert.throws(() => server({ networkProfile }));
});
test('Mosh is opt-in, validates prediction modes and preserves SSH authentication options', () => {
  const { moshArgs } = require('../electron/core.cjs');
  assert.equal(server().transport, 'ssh');
  for (const transport of ['udp', '--evil', {}]) assert.throws(() => server({ transport }));
  for (const prediction of ['experimental', '--evil', {}]) assert.throws(() => server({ prediction }));
  const args = moshArgs(server({ transport: 'mosh', prediction: 'always', port: 2222, identityFile: "/keys/my 'key $(evil)" }), 'harbor-abcd', '/opt/mosh-client');
  assert.ok(args.includes('--predict=always'));
  assert.ok(args.includes('--client=/opt/mosh-client'));
  assert.equal(args[args.indexOf('--') + 1], 'example.com');
  // Use a real shellwords parser, matching mosh's --ssh parsing, with metacharacters as data.
  const { execFileSync } = require('node:child_process');
  if (process.platform === 'win32') return; // WSL uses the same POSIX quoting tested on Linux/macOS.
  const parsed = execFileSync('/usr/bin/perl', ['-MText::ParseWords=shellwords', '-e', 'print join("\\0", shellwords($ARGV[0]))', args.find(arg => arg.startsWith('--ssh=')).slice('--ssh='.length)], { encoding: 'utf8' }).split('\0');
  assert.equal(parsed[0], '/usr/bin/ssh');
  assert.equal(parsed[parsed.indexOf('-i') + 1], "/keys/my 'key $(evil)");
  assert.equal(parsed[parsed.indexOf('-l') + 1], 'deploy');
  assert.equal(parsed[parsed.indexOf('-p') + 1], '2222');
  assert.match(args.at(-1), /tmux new-session -A -s 'harbor-abcd'/);
  assert.throws(() => moshArgs(server({ transport: 'mosh' }), "bad';whoami", '/opt/mosh-client'));
  assert.equal(moshArgs(server({ transport: 'mosh', persistent: false }), 'unused', '/opt/mosh-client').at(-1), 'example.com');
  assert.ok(!canRetry(server({ transport: 'mosh' }), 255, false), 'Mosh recovery belongs to Mosh; do not spawn duplicate servers');
});
test('authentication modes support PEM, encrypted keys, certificates and passwords without copying credentials', () => {
  assert.equal(server().authMode, 'auto');
  assert.throws(() => server({ authMode: 'key' }));
  assert.throws(() => server({ authMode: 'invalid' }));
  const key = sshArgs(server({ authMode: 'key', identityFile: '/keys/aws.pem', certificateFile: '/keys/aws-cert.pub' }), 'harbor-abcd');
  for (const option of ['IdentitiesOnly=yes', 'PubkeyAuthentication=yes', 'PreferredAuthentications=publickey', 'PasswordAuthentication=no', 'KbdInteractiveAuthentication=no', 'CertificateFile="/keys/aws-cert.pub"']) assert.ok(key.includes(option));
  const combined = sshArgs(server({ authMode: 'key-password', identityFile: '/keys/aws.pem' }), 'harbor-abcd');
  for (const option of ['PasswordAuthentication=yes', 'KbdInteractiveAuthentication=yes', 'PreferredAuthentications=publickey,keyboard-interactive,password']) assert.ok(combined.includes(option));
  const password = sshArgs(server({ authMode: 'password', identityFile: '/ignored/key', certificateFile: '/ignored/cert' }), 'harbor-abcd');
  assert.ok(password.includes('PubkeyAuthentication=no'));
  assert.ok(!password.includes('-i'));
  assert.ok(!password.some(arg => arg.startsWith('CertificateFile=')));
  assert.throws(() => server({ certificateFile: '/key\nInjectedOption' }));
});
