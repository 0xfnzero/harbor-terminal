require('../electron/locale.cjs').setLanguage('zh-CN');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { validateServer, moshArgs } = require('../electron/core.cjs');
const { portSpec, firewallScript } = require('../electron/network.cjs');
const server = extra => validateServer({ name: 'test', host: 'example.com', ...extra });

test('Mosh uses one configurable UDP port by default and bounds optional ranges', () => {
  assert.equal(portSpec(server()), '60042');
  assert.ok(moshArgs(server(), 'harbor-abcd', '/bin/mosh-client').includes('--port=60042'));
  assert.equal(portSpec(server({ moshPort: 61000, moshPortEnd: 61003 })), '61000:61003');
  assert.equal(portSpec(server({ moshPort: 61000, moshPortEnd: 61003 }), '-'), '61000-61003');
  for (const extra of [{ moshPort: 22 }, { moshPort: 65536 }, { moshPort: '60042;evil' }, { moshPort: 60042, moshPortEnd: 60041 }, { moshPort: 60042, moshPortEnd: 60106 }]) assert.throws(() => server(extra));
});

test('firewall adapters add only the configured UDP rule and surface privilege failures', { skip: process.platform === 'win32' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harbor-firewall-'));
  const log = path.join(dir, 'calls');
  const executable = (name, script) => fs.writeFileSync(path.join(dir, name), '#!/bin/sh\n' + script, { mode: 0o700 });
  const run = s => spawnSync('/bin/sh', ['-c', firewallScript(server(s))], { env: { PATH: dir, HARBOR_TEST_LOG: log }, encoding: 'utf8' });
  try {
    executable('id', '/bin/echo 0\n');
    executable('ufw', 'printf "%s\\n" "$*" >> "$HARBOR_TEST_LOG"\n');
    let result = run({});
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(log, 'utf8'), 'allow 60042/udp comment Harbor Mosh\n');
    fs.unlinkSync(path.join(dir, 'ufw')); fs.writeFileSync(log, '');
    executable('firewall-cmd', 'printf "%s\\n" "$*" >> "$HARBOR_TEST_LOG"\n');
    result = run({ moshPort: 61000, moshPortEnd: 61002 });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(log, 'utf8'), '--permanent --add-port=61000-61002/udp\n--add-port=61000-61002/udp\n');
    executable('id', '/bin/echo 1001\n');
    executable('sudo', 'printf "not allowed\\n" >&2; exit 1\n');
    result = run({});
    assert.equal(result.status, 72);
    assert.match(result.stdout, /firewall rule could not be applied/);
  } finally { fs.rmSync(dir, { recursive: true }); }
});
