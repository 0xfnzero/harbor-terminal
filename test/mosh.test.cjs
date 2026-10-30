require('../electron/locale.cjs').setLanguage('zh-CN');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const dgram = require('node:dgram');
const path = require('node:path');
const fs = require('node:fs');
const pty = require('node-pty');
const { Terminal } = require('@xterm/headless');
const { findMosh } = require('../electron/transport.cjs');
const found = findMosh();
const serverPath = found && path.join(path.dirname(found.executable), 'mosh-server');

test('real Mosh predicts input during a UDP outage and resumes the same remote process', {
  skip: !serverPath || !fs.existsSync(serverPath) ? 'Install Mosh to run real UDP integration' : false,
  timeout: 30000,
}, async () => {
  let serverPid;
  let terminal;
  let proxy;
  const timers = new Set();
  let exited = false;
  const screen = new Terminal({ cols: 100, rows: 24, allowProposedApi: true });
  try {
    const startup = execFileSync(serverPath, ['new', '-i', '127.0.0.1', '-p', '0', '-l', 'LANG=en_US.UTF-8', '--', '/bin/sh', '-c', 'printf "REMOTE_PID=%s\\n" "$$"; while IFS= read -r line; do printf "REMOTE:%s:%s\\n" "$$" "$line"; done'], {
      env: { ...process.env, LANG: 'en_US.UTF-8', MOSH_SERVER_NETWORK_TMOUT: '20' }, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const match = startup.match(/MOSH CONNECT (\d+) (\S+)/);
    assert.ok(match, 'Mosh bootstrap succeeded');
    const upstreamPort = Number(match[1]);
    const key = match[2];
    // macOS mosh-server writes detached PID to stderr, unavailable from execFileSync;
    // use the protocol shutdown handshake plus network timeout as cleanup fallback.
    proxy = dgram.createSocket('udp4');
    await new Promise(resolve => proxy.bind(0, '127.0.0.1', resolve));
    let client;
    let blocked = false;
    let dropped = 0;
    proxy.on('message', (message, rinfo) => {
      if (blocked) { dropped++; return; }
      const fromServer = rinfo.port === upstreamPort;
      if (!fromServer) client = rinfo;
      const destination = fromServer ? client?.port : upstreamPort;
      if (!destination) return;
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (blocked) { dropped++; return; }
        proxy.send(message, destination, '127.0.0.1');
      }, 120);
      timers.add(timer);
    });
    let output = '';
    let raw = '';
    terminal = pty.spawn(found.client, ['127.0.0.1', String(proxy.address().port)], {
      name: 'xterm-256color', cols: 100, rows: 24, cwd: process.cwd(),
      env: { ...process.env, MOSH_KEY: key, MOSH_PREDICTION_DISPLAY: 'always', LANG: 'en_US.UTF-8', TERM: 'xterm-256color' },
    });
    terminal.onData(data => { raw += data; screen.write(data, () => { output = Array.from({ length: screen.buffer.active.length }, (_, i) => screen.buffer.active.getLine(i).translateToString(true)).join('\n'); }); });
    terminal.onExit(() => { exited = true; });
    const until = async (predicate, timeout = 12000) => {
      const deadline = Date.now() + timeout;
      while (!predicate()) {
        assert.ok(!exited, 'Mosh client unexpectedly exited');
        assert.ok(Date.now() < deadline, `Mosh response deadline exceeded: ${JSON.stringify(raw.slice(-2000))}`);
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    };
    await until(() => /REMOTE_PID=(\d+)/.test(output));
    serverPid = Number(output.match(/REMOTE_PID=(\d+)/)[1]);
    terminal.write('training\r');
    await until(() => output.includes(`REMOTE:${serverPid}:training`));
    await new Promise(resolve => setTimeout(resolve, 600));
    // Mosh establishes echo confidence after an acknowledged character on this line.
    terminal.write('p');
    await until(() => output.split('\n').includes('p'));
    await new Promise(resolve => setTimeout(resolve, 400));
    blocked = true;
    output = '';
    const start = Date.now();
    terminal.write('redictioncheck');
    await until(() => output.includes('predictioncheck'), 1500);
    assert.ok(Date.now() - start < 1500, 'local prediction appears while every UDP packet is blocked');
    await new Promise(resolve => setTimeout(resolve, 3000));
    assert.ok(dropped > 0, 'packets really were dropped');
    blocked = false;
    terminal.write('\r');
    await new Promise(resolve => setTimeout(resolve, 1200));
    output = '';
    terminal.write('RECOVERED_MARKER\r');
    await until(() => output.includes(`REMOTE:${serverPid}:RECOVERED_MARKER`));
    process.kill(serverPid, 0); // same remote shell acknowledged the post-outage command
    assert.equal(exited, false);
    // Mosh escape sequence requests a clean server-side shutdown.
    terminal.write('\x1e.');
    await new Promise(resolve => setTimeout(resolve, 1000));
  } finally {
    for (const timer of timers) clearTimeout(timer);
    terminal?.kill();
    proxy?.close();
    screen.dispose();
    if (serverPid) { try { process.kill(serverPid, 'SIGTERM'); } catch {} }
  }
});
