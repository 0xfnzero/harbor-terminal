const { t: tr } = require('./locale.cjs');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const { portSpec } = require('./network.cjs');

const networkProfiles = Object.freeze({
  balanced: { interval: 15, count: 3, timeout: 12 },
  tolerant: { interval: 15, count: 12, timeout: 30 },
  responsive: { interval: 5, count: 3, timeout: 10 },
});

function validateServer(input) {
  const s = {
    id: typeof input.id === 'string' && /^[a-zA-Z0-9-]{1,64}$/.test(input.id) ? input.id : crypto.randomUUID(),
    name: String(input.name || '').trim(), host: String(input.host || '').trim(),
    username: String(input.username || '').trim(), port: Number(input.port ?? 22),
    identityFile: String(input.identityFile || '').trim(), certificateFile: String(input.certificateFile || '').trim(),
    authMode: input.authMode ?? 'auto',
    moshPort: Number(input.moshPort ?? 60042), moshPortEnd: Number(input.moshPortEnd ?? input.moshPort ?? 60042),
    transport: input.transport ?? 'ssh', prediction: input.prediction ?? 'adaptive',
    networkProfile: input.networkProfile ?? 'balanced', compression: input.compression === true,
    persistent: input.persistent !== false, autoReconnect: input.autoReconnect !== false,
  };
  if (!['auto', 'key', 'key-password', 'password'].includes(s.authMode)) throw new Error(tr("认证方式不正确"));
  if (['key', 'key-password'].includes(s.authMode) && !s.identityFile) throw new Error(tr("请选择用于登录的私钥或 PEM 文件"));
  if (s.certificateFile.includes('\0') || s.certificateFile.includes('\n') || s.certificateFile.includes('\r')) throw new Error(tr("SSH 证书路径不正确"));
  portSpec(s);
  if (!['ssh', 'mosh'].includes(s.transport)) throw new Error(tr("连接模式不正确"));
  if (!['adaptive', 'always', 'never'].includes(s.prediction)) throw new Error(tr("预测回显模式不正确"));
  if (!Object.hasOwn(networkProfiles, s.networkProfile)) throw new Error(tr("网络策略不正确"));
  if (!s.name || s.name.length > 80) throw new Error(tr("请输入服务器名称（最多 80 个字符）"));
  if (!/^[a-zA-Z0-9][a-zA-Z0-9.:%_-]*$/.test(s.host) || s.host.length > 253) throw new Error(tr("请输入有效的主机名、SSH 别名或 IP（IPv6 无需方括号）"));
  if (s.username && !/^[a-zA-Z0-9_][a-zA-Z0-9_.-]*\$?$/.test(s.username)) throw new Error(tr("SSH 用户名格式不正确"));
  if (!Number.isInteger(s.port) || s.port < 1 || s.port > 65535) throw new Error(tr("端口必须介于 1 和 65535 之间"));
  if (s.identityFile.includes('\0') || s.identityFile.includes('\n') || s.identityFile.includes('\r')) throw new Error(tr("密钥路径不正确"));
  return s;
}

const quote = (value) => "'" + value.replace(/'/g, "'\\''") + "'";

function sshArgs(server, sessionName) {
  const policy = networkProfiles[server.networkProfile ?? 'balanced'];
  if (!policy) throw new Error(tr("网络策略不正确"));
  const args = ['-tt', '-o', `ServerAliveInterval=${policy.interval}`, '-o', `ServerAliveCountMax=${policy.count}`, '-o', `ConnectTimeout=${policy.timeout}`, '-o', 'TCPKeepAlive=yes', '-o', `Compression=${server.compression ? 'yes' : 'no'}`, '-p', String(server.port)];
  if (server.username) args.push('-l', server.username);
  const auth = server.authMode ?? 'auto';
  const expand = file => file.startsWith('~/') ? path.join(os.homedir(), file.slice(2)) : file;
  if (auth === 'password') {
    args.push('-o', 'PubkeyAuthentication=no', '-o', 'PasswordAuthentication=yes', '-o', 'KbdInteractiveAuthentication=yes', '-o', 'PreferredAuthentications=keyboard-interactive,password');
  } else {
    if (server.identityFile) args.push('-i', expand(server.identityFile), '-o', 'IdentitiesOnly=yes');
    if (server.certificateFile) args.push('-o', 'CertificateFile="' + expand(server.certificateFile).replaceAll('\\', '\\\\').replaceAll('"', '\\"') + '"');
    if (auth === 'key') args.push('-o', 'PubkeyAuthentication=yes', '-o', 'PasswordAuthentication=no', '-o', 'KbdInteractiveAuthentication=no', '-o', 'PreferredAuthentications=publickey');
    if (auth === 'key-password') args.push('-o', 'PubkeyAuthentication=yes', '-o', 'PasswordAuthentication=yes', '-o', 'KbdInteractiveAuthentication=yes', '-o', 'PreferredAuthentications=publickey,keyboard-interactive,password');
  }
  args.push('--', server.host);
  if (server.persistent) {
    args.push(remoteCommand(sessionName));
  }
  return args;
}

function remoteCommand(sessionName) {
  if (!/^harbor-[a-f0-9-]+$/.test(sessionName)) throw new Error(tr("无效的远程会话标识"));
  const message = quote(tr('请先在服务器安装 tmux，或关闭此连接的持久会话选项。'));
  return `if command -v tmux >/dev/null 2>&1; then exec tmux new-session -A -s ${quote(sessionName)}; else printf '\\r\\n[Harbor] %s\\r\\n' ${message}; exit 69; fi`;
}

function moshArgs(server, sessionName, clientPath, sshExecutable = '/usr/bin/ssh') {
  // mosh parses --ssh using shellwords; quote each argument independently.
  const ssh = sshArgs({ ...server, persistent: false }, sessionName);
  const bootstrap = [sshExecutable, ...ssh.slice(1, ssh.indexOf('--'))].map(quote).join(' ');
  const args = [`--port=${portSpec(server)}`, '--experimental-remote-ip=remote', '--server=env PATH="$HOME/.local/bin:$PATH" mosh-server', `--ssh=${bootstrap}`, `--client=${clientPath}`, `--predict=${server.prediction ?? 'adaptive'}`, '--', server.host];
  if (server.persistent) args.push('sh', '-c', remoteCommand(sessionName));
  return args;
}

function retryDelay(attempt) { return Math.min(1000 * 2 ** Math.min(attempt, 5), 30000); }
function canRetry(server, exitCode, stopped) { return Boolean(server?.transport !== 'mosh' && server?.autoReconnect && !stopped && exitCode === 255); }

module.exports = { validateServer, sshArgs, moshArgs, retryDelay, canRetry };
