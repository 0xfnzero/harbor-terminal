const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const http = require('node:http');
const { endpoint, systemEndpoints, discoverProxies, probe, connectTunnel } = require('../electron/proxy.cjs');
const { directRouting, proxyOptions, authStarted, authenticated, networkFailure, SshAttempt } = require('../electron/ssh-routing.cjs');
const fs = require('node:fs');
const { once } = require('node:events');
const os = require('node:os');
const path = require('node:path');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function listen(server) { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return server.address().port; }
const close = server => new Promise(resolve => server.close(resolve));

test('discovers loopback proxies from system settings and environment without using remote/authenticated URLs', async () => {
  const socks = { protocol: 'socks5', host: '127.0.0.1', port: 43210 };
  assert.deepEqual(endpoint('socks5h://127.0.0.1:43210'), socks);
  for (const bad of ['http://example.com:80', 'http://user:pass@localhost:7897', 'file:///tmp/socket', 'http://127.999.1.1:90', 'http://127.0.0.1:99999']) assert.equal(endpoint(bad), null);
  assert.deepEqual(systemEndpoints('SOCKSEnable : 1\n SOCKSProxy : 127.0.0.1\n SOCKSPort : 43210\n HTTPEnable : 0\n HTTPProxy : localhost\n HTTPPort : 7890', 'darwin'), [socks]);
  assert.deepEqual(systemEndpoints('ProxyEnable REG_DWORD 0x1\nProxyServer REG_SZ socks=127.0.0.1:43210;https=localhost:43211', 'win32'), [socks, { protocol: 'http', host: 'localhost', port: 43211 }]);
  assert.deepEqual(systemEndpoints('ProxyEnable REG_DWORD 0x0\nProxyServer REG_SZ localhost:7890', 'win32'), []);
  const checked = [];
  const found = await discoverProxies({ env: { ALL_PROXY: 'socks5://127.0.0.1:43210', HTTPS_PROXY: 'http://localhost:43211' }, system: async () => [socks], check: async p => { checked.push(p); return p.port >= 43210; } });
  assert.deepEqual(found, [socks, { protocol: 'http', host: 'localhost', port: 43211 }]);
  assert.equal(checked.filter(p => p.port === 43210).length, 1);
});

test('SOCKS5 and HTTP CONNECT preserve binary payload and reject incompatible or closed proxies', async () => {
  const sockets = new Set();
  const track = socket => { sockets.add(socket); socket.on('error', () => {}); socket.on('close', () => sockets.delete(socket)); };
  const target = net.createServer(socket => { track(socket); socket.write(Buffer.from([0, 255, 42])); socket.pipe(socket); });
  const targetPort = await listen(target);
  const socks = net.createServer(socket => {
    track(socket); let stage = 0;
    socket.on('data', function request(data) {
      if (stage++ === 0) { socket.write(Buffer.from([5])); setTimeout(() => socket.write(Buffer.from([0])), 5); return; }
      assert.equal(data[3], 3); assert.equal(data.subarray(5, 5 + data[4]).toString(), '127.0.0.1');
      socket.off('data', request);
      const upstream = net.createConnection(targetPort, '127.0.0.1', () => { socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, targetPort >> 8, targetPort & 255])); socket.pipe(upstream); upstream.pipe(socket); });
      track(upstream); upstream.on('error', () => socket.destroy()); socket.on('close', () => upstream.destroy());
    });
  });
  const httpProxy = http.createServer();
  httpProxy.on('connect', (req, socket) => {
    track(socket);
    if (req.url === '127.0.0.1:0') { socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'); return; }
    const upstream = net.createConnection(targetPort, '127.0.0.1', () => { socket.write('HTTP/1.1 200 Connection Established\r\n\r\n'); socket.pipe(upstream); upstream.pipe(socket); });
    track(upstream); socket.on('close', () => upstream.destroy()); upstream.on('error', () => socket.destroy());
  });
  const socksPort = await listen(socks), httpPort = await listen(httpProxy);
  try {
    for (const proxy of [{ protocol: 'socks5', host: '127.0.0.1', port: socksPort }, { protocol: 'http', host: '127.0.0.1', port: httpPort }]) {
      assert.equal(await probe(proxy, 1000), true);
      const socket = await connectTunnel(proxy, '127.0.0.1', targetPort); track(socket);
      let received = Buffer.alloc(0); socket.on('data', data => { received = Buffer.concat([received, data]); }); socket.resume();
      const payload = Buffer.from([0, 1, 2, 128, 254, 255]); socket.write(payload);
      const deadline = Date.now() + 3000;
      while (received.length < payload.length + 3 && Date.now() < deadline) await delay(10);
      assert.deepEqual(received, Buffer.concat([Buffer.from([0, 255, 42]), payload])); socket.destroy();
    }
    assert.equal(await probe({ protocol: 'socks5', host: '127.0.0.1', port: httpPort }, 100), false);
    await assert.rejects(connectTunnel({ protocol: 'socks5', host: '127.0.0.1', port: socksPort }, 'bad\r\nHost: x', 22));
  } finally { for (const socket of sockets) socket.destroy(); await Promise.all([close(target), close(socks), close(httpProxy)]); }
});

test('SSH handshake deadline stops at authentication or user prompts, and cleans up private diagnostics', async () => {
  let expired = 0;
  const attempt = new SshAttempt({ timeout: 30, onTimeout: () => ++expired });
  await delay(130); assert.equal(expired, 1); attempt.dispose(); assert.equal(fs.existsSync(attempt.directory), false);
  const auth = new SshAttempt({ timeout: 30, onTimeout: () => ++expired });
  fs.writeFileSync(auth.file, 'debug1: SSH2_MSG_SERVICE_ACCEPT received\n'); await delay(130); assert.equal(expired, 1); auth.dispose();
  const prompt = new SshAttempt({ timeout: 30, onTimeout: () => ++expired });
  prompt.output('Are you sure you want to continue connecting (yes/no)?'); await delay(130); assert.equal(expired, 1); prompt.dispose();
  assert.equal(authStarted('Authenticated to host using "publickey".'), true);
  assert.equal(authenticated('debug1: Offering public key'), false);
  assert.equal(networkFailure('Connection reset by host port 22'), true);
  assert.equal(networkFailure('Permission denied (publickey).'), false);
  assert.equal(networkFailure('Bad configuration option: InvalidSetting'), false);
  assert.ok(proxyOptions({ protocol: 'socks5', host: '127.0.0.1', port: 7897 }, '/tmp/a $b%/Electron', '/tmp/a helper.cjs').join(' ').includes('%%'));
});

test('existing local SOCKS workaround becomes a fallback while custom jump routes remain intact', { skip: process.platform === 'win32' }, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'harbor-ssh-route-config-'));
  const config = path.join(directory, 'config');
  try {
    fs.writeFileSync(config, 'Host fixture\n HostName example.invalid\n ProxyCommand /usr/bin/nc -X 5 -x 127.0.0.1:43210 %h %p\n');
    const local = await directRouting('/usr/bin/ssh', ['-F', config, '--', 'fixture']);
    assert.deepEqual(local.extra, [{ protocol: 'socks5', host: '127.0.0.1', port: 43210 }]);
    assert.ok(local.options.includes('ProxyCommand=none'));
    for (const route of ['ProxyJump bastion.example', 'ProxyCommand custom-ssh-route %h %p']) {
      fs.writeFileSync(config, `Host fixture\n HostName example.invalid\n ${route}\n`);
      assert.deepEqual(await directRouting('/usr/bin/ssh', ['-F', config, '--', 'fixture']), { options: [], extra: [] });
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
