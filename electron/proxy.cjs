const net = require('node:net');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
const isLoopback = host => host === 'localhost' || host === '::1' || (net.isIP(host || '') === 4 && host.startsWith('127.'));

function endpoint(value, protocol = 'http') {
  try {
    const url = new URL(value.includes('://') ? value : `${protocol}://${value}`);
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (!isLoopback(host)) return null;
    if (url.username || url.password || !['http:', 'socks5:', 'socks5h:', 'socks:'].includes(url.protocol)) return null;
    const port = Number(url.port || (url.protocol === 'http:' ? 80 : 1080));
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    return { host, port, protocol: url.protocol === 'http:' ? 'http' : 'socks5' };
  } catch { return null; }
}
function systemEndpoints(text, platform) {
  const values = [];
  if (platform === 'darwin') {
    for (const [name, protocol] of [['SOCKS', 'socks5'], ['HTTPS', 'http'], ['HTTP', 'http']]) {
      if (!new RegExp(`\\b${name}Enable\\s*:\\s*1\\b`).test(text)) continue;
      const host = text.match(new RegExp(`\\b${name}Proxy\\s*:\\s*(\\S+)`))?.[1];
      const port = text.match(new RegExp(`\\b${name}Port\\s*:\\s*(\\d+)`))?.[1];
      if (host && port) values.push(endpoint(`${host.includes(':') ? `[${host}]` : host}:${port}`, protocol));
    }
  } else if (platform === 'win32' && /ProxyEnable\s+REG_DWORD\s+0x1\b/i.test(text)) {
    const spec = text.match(/ProxyServer\s+REG_SZ\s+([^\r\n]+)/i)?.[1]?.trim();
    for (const entry of spec?.split(';') || []) {
      const [kind, address] = entry.includes('=') ? entry.split('=') : ['http', entry];
      if (['http', 'https', 'socks'].includes(kind)) values.push(endpoint(address, kind === 'socks' ? 'socks5' : 'http'));
    }
  }
  return values.filter(Boolean);
}
async function readSystemEndpoints(platform = process.platform) {
  try {
    if (platform === 'darwin') return systemEndpoints((await run('/usr/sbin/scutil', ['--proxy'], { timeout: 1500 })).stdout, platform);
    if (platform === 'win32') return systemEndpoints((await run('reg.exe', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'], { timeout: 1500, windowsHide: true })).stdout, platform);
    const mode = (await run('gsettings', ['get', 'org.gnome.system.proxy', 'mode'], { timeout: 1000 })).stdout.trim();
    if (mode !== "'manual'") return [];
    return (await Promise.all(['socks', 'http', 'https'].map(async kind => {
      const results = await Promise.all(['host', 'port'].map(key => run('gsettings', ['get', `org.gnome.system.proxy.${kind}`, key], { timeout: 1000 })));
      return endpoint(`${results[0].stdout.trim().replace(/^'|'$/g, '')}:${results[1].stdout.trim()}`, kind === 'socks' ? 'socks5' : 'http');
    }))).filter(Boolean);
  } catch { return []; }
}
function exchange(socket, write, complete, timeout = 1500) {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    const timer = setTimeout(() => done(new Error('Proxy handshake timed out')), timeout);
    const done = (error, value) => {
      clearTimeout(timer); socket.off('data', data); socket.off('error', fail); socket.off('end', ended);
      if (error) reject(error); else resolve(value);
    };
    const fail = error => done(error);
    const ended = () => done(new Error('Proxy closed the connection'));
    const data = chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      try {
        if (buffer.length > 32768) throw new Error('Proxy response too large');
        const result = complete(buffer);
        if (result) {
          socket.pause();
          const extra = buffer.subarray(result.length);
          done(null, result.value);
          if (extra.length) socket.unshift(extra);
        }
      } catch (error) { done(error); }
    };
    socket.on('data', data); socket.once('error', fail); socket.once('end', ended);
    socket.resume(); socket.write(write);
  });
}
async function dial(proxy, timeout = 1500) {
  const socket = net.createConnection({ host: proxy.host, port: proxy.port });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => socket.destroy(new Error('Proxy connection timed out')), timeout);
    socket.once('connect', () => { clearTimeout(timer); socket.off('error', failed); resolve(); });
    const failed = error => { clearTimeout(timer); reject(error); };
    socket.once('error', failed);
  });
  return socket;
}
async function socksHello(socket, timeout) {
  await exchange(socket, Buffer.from([5, 1, 0]), data => {
    if (data.length < 2) return null;
    if (data[0] !== 5 || data[1] !== 0) throw new Error('SOCKS5 proxy requires unsupported authentication');
    return { length: 2 };
  }, timeout);
}
async function probe(proxy, timeout = 400) {
  let socket;
  try {
    socket = await dial(proxy, timeout);
    if (proxy.protocol === 'socks5') await socksHello(socket, timeout);
    else await exchange(socket, 'CONNECT 127.0.0.1:0 HTTP/1.1\r\nHost: 127.0.0.1:0\r\n\r\n', data => {
      const end = data.indexOf('\r\n\r\n');
      if (end < 0) return null;
      if (!/^HTTP\/1\.[01] (200|403|502|503|504)\b/.test(data.toString('latin1'))) throw new Error('Not an available HTTP CONNECT proxy');
      return { length: end + 4 };
    }, timeout);
    return true;
  } catch { return false; }
  finally { socket?.destroy(); }
}
async function discoverProxies({ env = process.env, system = readSystemEndpoints, check = probe, extra = [] } = {}) {
  const candidates = [...extra];
  for (const key of ['ALL_PROXY', 'all_proxy', 'HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy']) {
    if (env[key]) candidates.push(endpoint(env[key]));
  }
  candidates.push(...await system());
  for (const port of [7897, 7890, 1080, 10808, 10809, 1086, 6153, 20171]) {
    for (const protocol of ['socks5', 'http']) candidates.push({ host: '127.0.0.1', port, protocol });
  }
  const seen = new Set();
  const unique = candidates.filter(p => {
    if (!p || !endpoint(`${p.protocol}://${p.host.includes(':') ? `[${p.host}]` : p.host}:${p.port}`)) return false;
    const key = `${p.protocol}:${p.host}:${p.port}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  const available = await Promise.all(unique.map(async p => await check(p) ? p : null));
  return available.filter(Boolean);
}
async function connectTunnel(proxy, host, port, timeout = 10000) {
  if (!host || /[\s\0]/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid SSH destination');
  const socket = await dial(proxy, timeout);
  try {
    if (proxy.protocol === 'socks5') {
      await socksHello(socket, timeout);
      // A domain-form address lets the proxy resolve DNS, including IPv6 literals.
      const name = Buffer.from(host);
      if (name.length > 255) throw new Error('SSH destination too long');
      const request = Buffer.concat([Buffer.from([5, 1, 0, 3, name.length]), name, Buffer.from([port >> 8, port & 255])]);
      await exchange(socket, request, data => {
        if (data.length < 5) return null;
        if (data[0] !== 5 || data[1] !== 0) throw new Error('SOCKS5 tunnel rejected');
        const length = data[3] === 1 ? 10 : data[3] === 4 ? 22 : data[3] === 3 ? 7 + data[4] : 0;
        if (!length) throw new Error('Invalid SOCKS5 reply');
        return data.length >= length ? { length } : null;
      }, timeout);
    } else {
      const destination = `${host.includes(':') ? `[${host}]` : host}:${port}`;
      await exchange(socket, `CONNECT ${destination} HTTP/1.1\r\nHost: ${destination}\r\n\r\n`, data => {
        const end = data.indexOf('\r\n\r\n');
        if (end < 0) return null;
        if (!/^HTTP\/1\.[01] 200\b/.test(data.toString('latin1'))) throw new Error('HTTP CONNECT tunnel rejected');
        return { length: end + 4 };
      }, timeout);
    }
    return socket;
  } catch (error) { socket.destroy(); throw error; }
}
module.exports = { isLoopback, endpoint, systemEndpoints, readSystemEndpoints, discoverProxies, probe, connectTunnel };
