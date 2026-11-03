const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { cleanShell } = require('../electron/clean-shell.cjs');
test('recovery shell ignores user profile and inherited startup-file hooks', { skip: process.platform === 'win32' }, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'harbor-clean-'));
  try {
    for (const file of ['.profile', 'hook']) fs.writeFileSync(path.join(home, file), 'echo UNWANTED_STARTUP\n');
    const command = cleanShell();
    const result = spawnSync(command.executable, [...command.args, '-c', 'printf RECOVERY_OK'], { encoding: 'utf8', env: { ...process.env, HOME: home, ENV: path.join(home, 'hook'), BASH_ENV: path.join(home, 'hook'), ...command.env } });
    assert.equal(result.status, 0); assert.equal(result.stdout, 'RECOVERY_OK');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
test('Windows recovery opens PowerShell without loading profiles', () => {
  const command = cleanShell('win32', { SystemRoot: 'C:\\Windows' });
  assert.ok(command.args.includes('-NoProfile')); assert.ok(command.args.includes('-NoExit'));
  assert.equal(command.executable, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
});
