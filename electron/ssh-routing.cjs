const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { endpoint } = require('./proxy.cjs');
const run = promisify(execFile);

// Treat an existing local nc SOCKS setting as a discoverable fallback, so the
// temporary per-host workaround does not prevent the default direct attempt.
async function directRouting(executable, args) {
  const end = args.indexOf('--');
  try {
    const { stdout } = await run(executable, ['-G', ...args.slice(0, end + 2)], { timeout: 2000, windowsHide: true, maxBuffer: 262144 });
    const proxy = stdout.match(/^proxycommand (.+)$/m)?.[1];
    const jump = stdout.match(/^proxyjump (.+)$/m)?.[1];
    if (jump && jump !== 'none') return { options: [], extra: [] };
    if (proxy && proxy !== 'none') {
      const local = proxy.match(/^(?:\/usr\/bin\/)?nc -X 5 -x (\S+) %h %p$/);
      const candidate = local && endpoint(local[1], 'socks5');
      if (!candidate) return { options: [], extra: [] }; // Preserve intentional custom SSH routes.
      return { options: ['-o', 'ProxyCommand=none', '-o', 'ProxyJump=none'], extra: [candidate] };
    }
  } catch {} // OpenSSH itself will report configuration/host errors in the terminal.
  return { options: [], extra: [] };
}
function proxyOptions(proxy, executable = process.execPath, helper = path.join(__dirname, 'proxy-command.cjs')) {
  const spec = `${proxy.protocol}://${proxy.host.includes(':') ? `[${proxy.host}]` : proxy.host}:${proxy.port}`;
  // OpenSSH expands % tokens before passing ProxyCommand to the platform shell.
  const quote = value => '"' + (process.platform === 'win32'
    ? value.replaceAll('%', '%%').replaceAll('"', '\\"')
    : value.replaceAll('%', '%%').replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('$', '\\$').replaceAll('`', '\\`')) + '"';
  return ['-o', `ProxyCommand=${[executable, helper, spec].map(quote).join(' ')} %h %p`, '-o', 'ProxyJump=none'];
}
function authStarted(log) {
  return /SSH2_MSG_SERVICE_ACCEPT received|Authentications that can continue:|Next authentication method:|Authenticated to /i.test(log);
}
function authenticated(log) { return /Authenticated to .+ using /i.test(log); }
function networkFailure(log) {
  return /Connection (?:timed out|refused|reset|closed)|Operation timed out|No route to host|Network is unreachable|Could not resolve hostname|Connection to .+ (?:closed|reset)|Broken pipe|kex_exchange_identification:|\[Harbor proxy\]/i.test(log);
}
class SshAttempt {
  constructor({ timeout, onTimeout, options = [], clock = Date.now }) {
    this.directory = fs.mkdtempSync(path.join(os.tmpdir(), 'harbor-ssh-'));
    this.file = path.join(this.directory, 'diagnostic.log');
    this.options = ['-v', '-E', this.file, ...options];
    this.clock = clock; this.deadline = clock() + timeout;
    this.timedOut = false; this.interactive = false;
    this.timer = setInterval(() => {
      this.read();
      if (this.hasAuthenticated) { clearInterval(this.timer); return; }
      if (this.interactive || this.authenticating) return;
      if (clock() >= this.deadline) { this.timedOut = true; clearInterval(this.timer); onTimeout(); }
    }, 100);
    this.timer.unref();
  }
  read() {
    try {
      const fd = fs.openSync(this.file, 'r');
      try {
        const size = fs.fstatSync(fd).size;
        const buffer = Buffer.alloc(Math.min(size, 65536));
        fs.readSync(fd, buffer, 0, buffer.length, Math.max(0, size - buffer.length));
        const text = buffer.toString('utf8');
        this.hasAuthenticated ||= authenticated(text);
        this.authenticating ||= authStarted(text);
        return text;
      } finally { fs.closeSync(fd); }
    } catch { return ''; }
  }
  input() { this.interactive = true; }
  output(data) {
    // Host trust/passphrase/password prompts need unlimited time for the user.
    if (/password|passphrase|continue connecting|authenticity of host/i.test(data)) this.input();
  }
  dispose() {
    clearInterval(this.timer);
    fs.rmSync(this.directory, { recursive: true, force: true });
  }
}
module.exports = { directRouting, proxyOptions, authStarted, authenticated, networkFailure, SshAttempt };
