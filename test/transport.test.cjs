require('../electron/locale.cjs').setLanguage('zh-CN');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { platformTools, windowsRuntime } = require('../electron/transport.cjs');
const { linuxInstaller, localInstaller, windowsInstaller } = require('../electron/installers.cjs');

test('platform tools select Windows OpenSSH and an integrated PowerShell shell', () => {
  const win = platformTools('win32', { SystemRoot: 'D:\\Windows' });
  assert.equal(win.ssh, 'D:\\Windows\\System32\\OpenSSH\\ssh.exe');
  assert.equal(win.shell, 'D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.equal(win.wsl, 'D:\\Windows\\System32\\wsl.exe');
  assert.deepEqual(win.shellArgs, ['-NoLogo']);
  assert.equal(platformTools('linux', {}).shell, '/bin/sh');
  assert.equal(platformTools('darwin', { SHELL: '/bin/zsh' }).shell, '/bin/zsh');
});
test('runtime descriptors reject malformed distribution names', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harbor-runtime-'));
  const file = path.join(dir, 'runtime.json');
  try {
    for (const value of [{ distribution: '--exec evil', user: 'root' }, { distribution: 'Ubuntu', user: 'someone' }, {}, null]) {
      fs.writeFileSync(file, JSON.stringify(value));
      assert.equal(windowsRuntime(file), null);
    }
    fs.writeFileSync(file, JSON.stringify({ distribution: 'Ubuntu-24.04', user: 'root' }));
    assert.deepEqual(windowsRuntime(file), { distribution: 'Ubuntu-24.04', user: 'root' });
  } finally { fs.rmSync(dir, { recursive: true }); }
});
test('Unix installer scripts parse and reject unrecognized roles', { skip: process.platform === 'win32' }, () => {
  for (const script of [linuxInstaller('server'), linuxInstaller('client'), localInstaller('darwin')]) execFileSync('/bin/sh', ['-n', '-c', script]);
  assert.throws(() => linuxInstaller('malicious'));
  assert.ok(windowsInstaller().includes('-WindowStyle Hidden'));
});
