// npm can extract the bundled macOS helper without its executable mode.
const fs = require('node:fs');
const path = require('node:path');
if (process.platform === 'darwin') {
  const root = path.dirname(require.resolve('node-pty/package.json'));
  for (const arch of ['arm64', 'x64']) {
    const helper = path.join(root, 'prebuilds', `darwin-${arch}`, 'spawn-helper');
    if (fs.existsSync(helper)) fs.chmodSync(helper, 0o755);
  }
}
