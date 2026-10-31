const { t: tr } = require('./locale.cjs');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { firewallScript } = require('./network.cjs');
const { sshArgs, moshArgs } = require('./core.cjs');
const { linuxInstaller, localInstaller, windowsInstaller, tmuxInstaller, quote } = require('./installers.cjs');
const run = promisify(execFile);
const wslEnvironment = 'root="$HOME/.local/share/harbor/components/mosh/current"; if [ -d "$root" ]; then export PATH="$root/usr/bin:$PATH"; export LD_LIBRARY_PATH="$(find "$root/usr/lib" -type d | paste -sd : -)${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"; fi; ';

function platformTools(platform = process.platform, env = process.env) {
  if (platform === 'win32') {
    const system = path.win32.join(env.SystemRoot || 'C:\\Windows', 'System32');
    return { ssh: path.win32.join(system, 'OpenSSH', 'ssh.exe'), shell: path.win32.join(system, 'WindowsPowerShell', 'v1.0', 'powershell.exe'), shellArgs: ['-NoLogo'], wsl: path.win32.join(system, 'wsl.exe') };
  }
  return { ssh: '/usr/bin/ssh', shell: env.SHELL || '/bin/sh', shellArgs: ['-l'] };
}
function findMosh(env = process.env) {
  const dirs = [...(env.PATH || '').split(path.delimiter), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', path.join(os.homedir(), '.local/share/harbor/components/mosh/current/usr/bin')].filter(Boolean);
  for (const dir of dirs) {
    if (!path.isAbsolute(dir)) continue;
    const executable = path.join(dir, 'mosh');
    const client = path.join(dir, 'mosh-client');
    try {
      fs.accessSync(executable, fs.constants.X_OK);
      fs.accessSync(client, fs.constants.X_OK);
      return { executable, client };
    } catch {}
  }
  return null;
}
function windowsRuntime(runtimePath) {
  try {
    const value = JSON.parse(fs.readFileSync(runtimePath, 'utf8'));
    if (typeof value.distribution === 'string' && /^[a-zA-Z0-9_.-]{1,80}$/.test(value.distribution) && value.user === 'root') return value;
  } catch {}
  return null;
}
async function capabilities(runtimePath) {
  if (process.platform !== 'win32') return { platform: process.platform, mosh: Boolean(findMosh()), backend: 'native' };
  const runtime = windowsRuntime(runtimePath);
  if (!runtime) return { platform: 'win32', mosh: false, backend: 'wsl' };
  try {
    await run(platformTools().wsl, ['--distribution', runtime.distribution, '--user', runtime.user, '--exec', 'sh', '-lc', wslEnvironment + 'command -v mosh && command -v mosh-client'], { timeout: 8000, windowsHide: true });
    return { platform: 'win32', mosh: true, backend: 'wsl' };
  } catch { return { platform: 'win32', mosh: false, backend: 'wsl' }; }
}
function sessionCommand(server, remoteName, purpose, runtimePath, configureNetwork = true, component = 'mosh') {
  if (!['mosh', 'tmux'].includes(component) || (component === 'tmux' && !['install-remote', 'check-remote'].includes(purpose)) || (purpose === 'check-remote' && component !== 'tmux')) throw new Error(tr("无效的组件操作"));
  const tools = platformTools();
  if (purpose === 'install-local') {
    if (process.platform === 'win32') return { executable: tools.shell, args: ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', Buffer.from(windowsInstaller(), 'utf16le').toString('base64')], env: { HARBOR_RUNTIME_CONFIG: runtimePath, HARBOR_LINUX_INSTALL_B64: Buffer.from(localInstaller('linux')).toString('base64') } };
    return { executable: '/bin/sh', args: ['-c', localInstaller()] };
  }
  if (purpose === 'install-remote' || purpose === 'check-remote') {
    if (!server) throw new Error(tr("请选择服务器"));
    const args = sshArgs({ ...server, persistent: false }, remoteName);
    const setup = component === 'tmux' ? tmuxInstaller(purpose === 'check-remote') : 'set -e\n(\n' + linuxInstaller('server') + '\n)\n' + (configureNetwork ? firewallScript(server) : '');
    args.push('sh -c ' + quote(setup));
    return { executable: tools.ssh, args };
  }
  if (!server) return { executable: tools.shell, args: tools.shellArgs };
  if (server.transport !== 'mosh') return { executable: tools.ssh, args: sshArgs(server, remoteName) };
  if (process.platform === 'win32') {
    const runtime = windowsRuntime(runtimePath);
    if (!runtime) throw new Error(tr("请先在「可选组件」安装增强终端运行环境。"));
    // Reuse Windows OpenSSH and its credentials; only the UDP client runs inside WSL.
    const sshInterop = '/mnt/' + tools.ssh[0].toLowerCase() + tools.ssh.slice(2).replaceAll('\\', '/');
    return { executable: tools.wsl, args: ['--distribution', runtime.distribution, '--user', runtime.user, '--exec', 'sh', '-lc', wslEnvironment + 'exec mosh "$@"', 'sh', ...moshArgs(server, remoteName, 'mosh-client', sshInterop)] };
  }
  const found = findMosh();
  if (!found) throw new Error(tr("未找到 Mosh。请打开「可选组件」安装，或编辑连接改用 SSH。"));
  const env = {};
  if (found.executable.includes('/harbor/components/')) {
    const libroot = path.resolve(path.dirname(found.executable), '../lib');
    const dirs = fs.readdirSync(libroot, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => path.join(libroot, d.name));
    env.LD_LIBRARY_PATH = [libroot, ...dirs, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');
  }
  return { executable: found.executable, args: moshArgs(server, remoteName, found.client), env };
}
module.exports = { findMosh, capabilities, platformTools, windowsRuntime, sessionCommand };
