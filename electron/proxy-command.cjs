// Invoked by OpenSSH as a binary stream bridge. Never print to stdout.
const { connectTunnel, endpoint } = require('./proxy.cjs');
(async () => {
  const [spec, host, port] = process.argv.slice(2);
  const proxy = endpoint(spec);
  if (!proxy) throw new Error('Invalid local proxy');
  const socket = await connectTunnel(proxy, host, Number(port));
  socket.on('error', error => { process.stderr.write(`[Harbor proxy] ${error.message}\n`); process.exitCode = 1; socket.destroy(); process.stdin.destroy(); });
  process.stdout.on('error', () => { socket.destroy(); process.stdin.destroy(); });
  process.stdin.on('error', () => socket.destroy());
  socket.on('close', () => process.stdin.destroy());
  process.stdin.pipe(socket); socket.pipe(process.stdout); socket.resume();
})().catch(error => { process.stderr.write(`[Harbor proxy] ${error.message}\n`); process.exitCode = 1; });
