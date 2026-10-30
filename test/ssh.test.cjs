require('../electron/locale.cjs').setLanguage('zh-CN');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync } = require('node:crypto');
const { spawn } = require('node:child_process');
const { platformTools } = require('../electron/transport.cjs');
const sshPath = platformTools().ssh;
const nullFile = process.platform === 'win32' ? 'NUL' : '/dev/null';
const { Server } = require('ssh2');
const { validateServer, sshArgs, canRetry } = require('../electron/core.cjs');

// A local SSH protocol fixture tests the real system OpenSSH transport without
// credentials, public infrastructure, or writes to the user's known_hosts file.
// It records the requested tmux command; it does not emulate tmux persistence.
test('real OpenSSH transport reports interruption and reuses the same tmux target', { timeout: 20000 }, async () => {
  const key = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } }).privateKey;
  const clients = new Set();
  const commands = [];
  let connectionCount = 0;
  const server = new Server({ hostKeys: [key] }, (client) => {
    clients.add(client);
    client.on('error', () => {});
    client.on('close', () => clients.delete(client));
    client.on('authentication', (ctx) => ctx.accept());
    client.on('ready', () => client.on('session', (accept) => {
      const session = accept();
      session.on('pty', (accept) => accept());
      session.on('exec', (accept, reject, info) => {
        commands.push(info.command);
        const stream = accept();
        connectionCount++;
        if (connectionCount === 1) { stream.write('BEFORE_DISCONNECT\r\n'); setTimeout(() => client.end(), 80); }
        else { stream.write('AFTER_RECONNECT\r\n'); stream.exit(0); stream.end(); }
      });
    }));
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const config = validateServer({ name: 'fixture', host: '127.0.0.1', username: 'fixture', port: server.address().port });
  const args = ['-F', nullFile, '-o', `UserKnownHostsFile=${nullFile}`, '-o', 'StrictHostKeyChecking=no', '-o', 'BatchMode=yes', ...sshArgs(config, 'harbor-abcd-1234')];
  const connect = () => new Promise((resolve, reject) => {
    const process = spawn(sshPath, args);
    let output = '';
    process.stdout.on('data', (data) => { output += data; });
    process.stderr.on('data', (data) => { output += data; });
    process.once('error', reject);
    process.once('exit', (code) => resolve({ code, output }));
  });
  try {
    const first = await connect();
    assert.equal(first.code, 255);
    assert.ok(canRetry(config, first.code, false));
    assert.match(first.output, /BEFORE_DISCONNECT/);
    const second = await connect();
    assert.equal(second.code, 0);
    assert.ok(!canRetry(config, second.code, false));
    assert.match(second.output, /AFTER_RECONNECT/);
    assert.equal(commands.length, 2);
    assert.equal(commands[0], commands[1]);
    assert.match(commands[0], /tmux new-session -A -s 'harbor-abcd-1234'/);
  } finally {
    for (const client of clients) client.end();
    await new Promise((resolve) => server.close(resolve));
  }
});

// Delay encrypted TCP traffic in both directions, then hold one input packet.
// This exercises real SSH buffering/keepalives, without touching host networking.
test('real SSH survives latency, idle keepalive and a temporary stalled link', { timeout: 45000 }, async () => {
  const net = require('node:net');
  const { Transform } = require('node:stream');
  const key = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } }).privateKey;
  const clients = new Set();
  const sockets = new Set();
  let stallNext = false;
  let connections = 0;
  let child;
  const fixture = new Server({ hostKeys: [key] }, (client) => {
    clients.add(client); connections++;
    client.on('error', () => {});
    client.on('authentication', ctx => ctx.accept());
    client.on('ready', () => client.on('session', accept => {
      const session = accept();
      session.on('pty', accept => accept());
      session.on('shell', accept => {
        const stream = accept();
        stream.write('LINK_READY\n');
        stream.on('data', data => stream.write(data));
      });
    }));
  });
  await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
  const proxy = net.createServer(downstream => {
    const upstream = net.connect(fixture.address().port, '127.0.0.1');
    for (const socket of [downstream, upstream]) {
      sockets.add(socket);
      socket.on('error', () => {});
      socket.on('close', () => { sockets.delete(socket); downstream.destroy(); upstream.destroy(); });
    }
    function delayed(direction) {
      return new Transform({ transform(chunk, encoding, done) {
        const hold = direction === 'up' && stallNext;
        if (hold) stallNext = false;
        setTimeout(() => done(null, chunk), hold ? 2200 : 120);
      }});
    }
    downstream.pipe(delayed('up')).pipe(upstream);
    upstream.pipe(delayed('down')).pipe(downstream);
  });
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  try {
    const config = validateServer({ name: 'delayed', host: '127.0.0.1', port: proxy.address().port, persistent: false, networkProfile: 'responsive' });
    child = spawn(sshPath, ['-F', nullFile, '-o', `UserKnownHostsFile=${nullFile}`, '-o', 'StrictHostKeyChecking=no', '-o', 'BatchMode=yes', ...sshArgs(config, 'unused')]);
    let output = '';
    let exited = false;
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', () => {});
    child.on('exit', () => { exited = true; });
    const until = async (predicate, timeout = 20000) => {
      const deadline = Date.now() + timeout;
      while (!predicate()) {
        assert.ok(!exited, 'SSH unexpectedly exited');
        assert.ok(Date.now() < deadline, 'SSH response deadline exceeded');
        await new Promise(resolve => setTimeout(resolve, 30));
      }
    };
    await until(() => output.includes('LINK_READY'));
    // More than one responsive-profile idle interval, with real encrypted traffic.
    await new Promise(resolve => setTimeout(resolve, 6200));
    stallNext = true;
    const start = Date.now();
    child.stdin.write('AFTER_STALL\n');
    await until(() => output.includes('AFTER_STALL'));
    assert.ok(Date.now() - start >= 2100, 'stall was actually injected');
    assert.equal(connections, 1, 'same SSH transport survived');
    assert.equal(exited, false);
  } finally {
    if (child && child.exitCode === null) {
      const done = new Promise(resolve => child.once('close', resolve));
      child.kill('SIGKILL');
      await done;
    }
    for (const socket of sockets) socket.destroy();
    for (const client of clients) client.end();
    await Promise.all([new Promise(resolve => proxy.close(resolve)), new Promise(resolve => fixture.close(resolve))]);
  }
});
