const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { tmuxInstaller } = require('../electron/installers.cjs');
const { sessionCommand } = require('../electron/transport.cjs');
const { validateServer } = require('../electron/core.cjs');

test('tmux installer checks without mutation, installs once and surfaces permission/package errors', { skip: process.platform === 'win32' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harbor-tmux-'));
  const log = path.join(dir, 'calls');
  const executable = (name, script) => fs.writeFileSync(path.join(dir, name), '#!/bin/sh\n' + script, { mode: 0o700 });
  const run = check => spawnSync('/bin/sh', ['-c', tmuxInstaller(check)], { env: { PATH: dir, LOG: log, BIN: dir }, encoding: 'utf8' });
  try {
    executable('id', 'echo 0');
    executable('apt-get', `echo "$*" >> "$LOG"
if [ "$1" = install ]; then
  printf '#!/bin/sh\\necho tmux-TEST\\n' > "$BIN/tmux"
  /bin/chmod 700 "$BIN/tmux"
fi`);
    assert.equal(run(true).status, 69);
    assert.equal(fs.existsSync(log), false, 'check never installs');
    assert.equal(run(false).status, 0);
    const calls = fs.readFileSync(log, 'utf8');
    assert.equal(calls, 'update\ninstall -y --no-install-recommends tmux\n');
    assert.equal(run(false).status, 0);
    assert.equal(fs.readFileSync(log, 'utf8'), calls, 'existing tmux is reused');
    fs.unlinkSync(path.join(dir, 'tmux'));
    executable('id', 'echo 1000');
    assert.equal(run(false).status, 77, 'no administrator capability');
    executable('sudo', 'exit 1');
    assert.equal(run(false).status, 1, 'sudo refusal is not success');
    executable('id', 'echo 0'); executable('apt-get', 'exit 42');
    assert.equal(run(false).status, 42, 'repository failure is not success');
    fs.unlinkSync(path.join(dir, 'apt-get'));
    assert.equal(run(false).status, 69, 'unsupported systems fail clearly');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('tmux component always uses SSH credentials without Mosh, persistence bootstrap or firewall', () => {
  const server = validateServer({ name: 'fixture', host: 'example.com', username: 'deploy', transport: 'mosh', persistent: true, authMode: 'key-password', identityFile: '/tmp/test.pem' });
  for (const purpose of ['check-remote', 'install-remote']) {
    const command = sessionCommand(server, 'harbor-abcd', purpose, '', true, 'tmux');
    assert.ok(command.executable.endsWith(process.platform === 'win32' ? 'ssh.exe' : '/ssh'));
    assert.ok(command.args.includes('/tmp/test.pem'));
    assert.match(command.args.at(-1), /tmux -V/);
    assert.doesNotMatch(command.args.at(-1), /new-session|ufw|firewall-cmd|mosh/);
  }
  assert.throws(() => sessionCommand(server, 'harbor-abcd', 'install-local', '', true, 'tmux'));
  assert.throws(() => sessionCommand(server, 'harbor-abcd', 'install-remote', '', true, 'untrusted'));
});
