const { _electron: electron } = require('playwright');
const { Server } = require('ssh2');
const net = require('node:net');
const http = require('node:http');
const { generateKeyPairSync } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { once } = require('node:events');
(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'harbor-proxy-ui-'));
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs1', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  const sockets = new Set(), clients = new Set(); let mode = 'up', app, proxyTunnels = 0, httpTunnels = 0, rejectTunnel = false, passed = false;
  const track = socket => { sockets.add(socket); socket.on('error', () => {}); socket.on('close', () => sockets.delete(socket)); };
  const ssh = new Server({ hostKeys: [privateKey] }, client => {
    clients.add(client); client.on('close', () => clients.delete(client)); client.on('error', () => {});
    client.on('authentication', ctx => mode === 'reject' ? ctx.reject(['publickey']) : ctx.accept());
    client.on('ready', () => client.on('session', accept => {
      const session = accept(); session.on('pty', accept => accept()); session.on('shell', accept => {
        const stream = accept(); stream.write('AUTO_PROXY_CONNECTED\r\n'); stream.on('data', () => stream.write('PROXY_INPUT_OK\r\n'));
      });
    }));
  });
  ssh.listen(0, '127.0.0.1'); await once(ssh, 'listening');
  const blackhole = net.createServer(track); blackhole.listen(0, '127.0.0.1'); await once(blackhole, 'listening');
  const proxy = net.createServer(socket => {
    track(socket); let buffer = Buffer.alloc(0), greeting = false;
    socket.on('data', function receive(chunk) {
      buffer = Buffer.concat([buffer, chunk]);
      if (!greeting) {
        if (buffer.length < 3) return;
        assert.equal(buffer[0], 5); buffer = buffer.subarray(2 + buffer[1]); greeting = true; socket.write(Buffer.from([5, 0]));
      }
      if (buffer.length < 5) return;
      assert.equal(buffer[3], 3);
      if (buffer.length < 7 + buffer[4]) return;
      ++proxyTunnels; socket.off('data', receive);
      if (rejectTunnel) { socket.end(Buffer.from([5, 5, 0, 1, 0, 0, 0, 0, 0, 0])); return; }
      const upstream = net.createConnection(ssh.address().port, '127.0.0.1', () => {
        socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 22])); socket.pipe(upstream); upstream.pipe(socket);
      });
      track(upstream); socket.on('close', () => upstream.destroy()); upstream.on('error', () => socket.destroy());
    });
  });
  proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening');
  const httpProxy = http.createServer();
  httpProxy.on('connect', (request, socket) => {
    track(socket);
    if (request.url === '127.0.0.1:0') { socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'); return; }
    ++httpTunnels;
    const upstream = net.createConnection(ssh.address().port, '127.0.0.1', () => { socket.write('HTTP/1.1 200 Connection Established\r\n\r\n'); socket.pipe(upstream); upstream.pipe(socket); });
    track(upstream); socket.on('close', () => upstream.destroy()); upstream.on('error', () => socket.destroy());
  });
  httpProxy.listen(0, '127.0.0.1'); await once(httpProxy, 'listening');
  try {
    app = await electron.launch({ ...(process.env.HARBOR_EXECUTABLE ? { executablePath: process.env.HARBOR_EXECUTABLE } : {}), args: [...(process.env.HARBOR_EXECUTABLE ? [] : ['.']), `--user-data-dir=${profile}`], env: { ...process.env, HARBOR_DEV: '0', ALL_PROXY: `socks5://127.0.0.1:${proxy.address().port}` } });
    const page = await app.firstWindow(); page.setDefaultTimeout(20000);
    await page.getByRole('button', { name: 'New local terminal', exact: true }).waitFor();
    await app.evaluate(({ app }, profile) => {
      const req = process.mainModule.require('node:module').createRequire(app.getAppPath() + '/package.json');
      const pty = req('node-pty'), spawn = pty.spawn; global.routeAttempts = []; global.routeLogs = [];
      pty.spawn = (file, args, options) => {
        if (file.endsWith('/ssh') || file.endsWith('ssh.exe')) {
          global.routeAttempts.push(args.some(arg => arg.includes('proxy-command.cjs')) ? 'proxy' : 'direct');
          global.routeLogs.push(args[args.indexOf('-E') + 1]);
          if (args.includes('stall-fixture.invalid')) args = ['-o', 'HostName=127.0.0.1', ...args];
          args = ['-F', process.platform === 'win32' ? 'NUL' : '/dev/null', '-o', `UserKnownHostsFile=${profile}/${global.testStrictTrust ? 'empty_known_hosts' : 'known_hosts'}`, '-o', `StrictHostKeyChecking=${global.testStrictTrust ? 'yes' : 'no'}`, '-o', 'BatchMode=yes', ...args];
        }
        return spawn(file, args, options);
      };
    }, profile);
    await page.evaluate(() => {
      window.proxyOutput = ''; window.proxyState = ''; window.proxyEvents = [];
      window.harbor.onEvent(e => { window.proxyEvents.push(e); if (e.type === 'data') window.proxyOutput += e.data; if (e.type === 'status') { window.proxyState = e.state; window.proxyMessage = e.message; } });
    });
    const open = async (host, port) => {
      const id = await page.evaluate(async ({ host, port }) => {
        window.proxyOutput = ''; window.proxyState = ''; window.proxyEvents = [];
        await window.harbor.saveServer({ id: 'proxy-fixture', name: 'Auto proxy fixture', host, port, username: 'fixture', persistent: false, autoReconnect: false, networkProfile: 'responsive' });
        const id = crypto.randomUUID(); await window.harbor.openSession({ id, serverId: 'proxy-fixture', cols: 80, rows: 24 }); return id;
      }, { host, port });
      return id;
    };
    const closeSession = id => page.evaluate(id => window.harbor.closeSession(id), id);
    let id = await open('127.0.0.1', ssh.address().port);
    await page.waitForFunction(() => window.proxyOutput.includes('AUTO_PROXY_CONNECTED'));
    assert.equal(proxyTunnels, 0); assert.deepEqual(await app.evaluate(() => global.routeAttempts), ['direct']);
    await closeSession(id);
    console.log('PASS healthy direct SSH never uses a proxy even when one is available');

    id = await open('route-fixture.invalid', ssh.address().port);
    await page.waitForFunction(() => window.proxyOutput.includes('AUTO_PROXY_CONNECTED'));
    assert.deepEqual(await app.evaluate(() => global.routeAttempts.slice(-2)), ['direct', 'proxy']); assert.equal(proxyTunnels, 1);
    await page.evaluate(id => window.harbor.input(id, 'check\r'), id);
    await page.waitForFunction(() => window.proxyOutput.includes('PROXY_INPUT_OK'));
    for (const client of clients) client.end();
    await page.waitForFunction(() => window.proxyState === 'exited');
    await page.evaluate(async id => { window.proxyOutput = ''; await window.harbor.reconnect(id); }, id);
    await page.waitForFunction(() => window.proxyOutput.includes('AUTO_PROXY_CONNECTED'));
    assert.deepEqual(await app.evaluate(() => global.routeAttempts.slice(-2)), ['direct', 'proxy']);
    await closeSession(id);
    console.log('PASS failed direct DNS automatically discovers SOCKS, real SSH login/input works, manual reconnect starts direct again');

    await app.evaluate((_electron, port) => { process.env.HTTPS_PROXY = `http://127.0.0.1:${port}`; process.env.https_proxy = ''; }, httpProxy.address().port);
    rejectTunnel = true;
    id = await open('route-fixture.invalid', ssh.address().port);
    await page.waitForFunction(() => window.proxyOutput.includes('AUTO_PROXY_CONNECTED'));
    assert.deepEqual(await app.evaluate(() => global.routeAttempts.slice(-3)), ['direct', 'proxy', 'proxy']); assert.equal(httpTunnels, 1);
    await closeSession(id); rejectTunnel = false;
    console.log('PASS rejected SOCKS tunnel falls through to a discovered HTTP CONNECT proxy and logs in');

    mode = 'reject'; const tunnelsBefore = proxyTunnels;
    id = await open('route-fixture.invalid', ssh.address().port);
    await page.waitForFunction(() => window.proxyState === 'error');
    assert.match(await page.evaluate(() => window.proxyMessage), /SSH authentication failed/);
    await page.waitForTimeout(300); assert.equal(proxyTunnels, tunnelsBefore + 1);
    await closeSession(id); mode = 'up';
    console.log('PASS authentication failure stops route switching and retrying');

    await app.evaluate(() => { global.testStrictTrust = true; });
    const beforeTrust = proxyTunnels;
    id = await open('route-fixture.invalid', ssh.address().port);
    await page.waitForFunction(() => window.proxyState === 'error');
    assert.match(await page.evaluate(() => window.proxyMessage), /host key verification failed/);
    assert.equal(proxyTunnels, beforeTrust + 1); await closeSession(id);
    await app.evaluate(() => { global.testStrictTrust = false; });
    console.log('PASS failed host identity verification stops switching without accepting unknown keys');

    id = await open('stall-fixture.invalid', blackhole.address().port);
    await page.waitForFunction(() => window.proxyOutput.includes('AUTO_PROXY_CONNECTED'), null, { timeout: 22000 });
    assert.deepEqual(await app.evaluate(() => global.routeAttempts.slice(-2)), ['direct', 'proxy']);
    await closeSession(id);
    const spawnsBefore = await app.evaluate(() => global.routeAttempts.length);
    id = await open('stall-fixture.invalid', blackhole.address().port);
    while (await app.evaluate(() => global.routeAttempts.length) === spawnsBefore) await page.waitForTimeout(20);
    const beforeClose = proxyTunnels; await closeSession(id);
    await page.waitForTimeout(500); assert.equal(proxyTunnels, beforeClose);
    const attempts = await app.evaluate(() => global.routeAttempts);
    assert.ok(attempts.length >= 9);
    for (const log of await app.evaluate(() => global.routeLogs)) await assert.rejects(fs.access(log));
    console.log('PASS stalled pre-authentication handshake falls back; closing a pending session cancels it');
    passed = true;
  } finally {
    if (app && !passed) console.error(await (await app.firstWindow()).evaluate(() => ({ state: window.proxyState, output: window.proxyOutput, message: window.proxyMessage })));
    if (app) await app.close(); for (const client of clients) client.end(); for (const socket of sockets) socket.destroy();
    await Promise.all([ssh, proxy, blackhole, httpProxy].map(server => new Promise(resolve => server.close(resolve))));
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
