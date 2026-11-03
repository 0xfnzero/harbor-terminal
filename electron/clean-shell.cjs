// Recovery shell skips user startup scripts; it is not an isolated environment.
function cleanShell(platform = process.platform, env = process.env) {
  if (platform === 'win32') {
    const path = require('node:path');
    return { executable: path.win32.join(env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), args: ['-NoLogo', '-NoProfile', '-NoExit'] };
  }
  return { executable: '/bin/sh', args: ['-i'], env: { ENV: '', BASH_ENV: '', PS1: '$ ' } };
}
module.exports = { cleanShell };
