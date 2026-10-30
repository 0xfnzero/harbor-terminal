const path = require('node:path');
const { spawnSync } = require('node:child_process');
const [requested = 'native', requestedArch = 'native', output = 'release'] = process.argv.slice(2);
const platform = requested === 'native' ? process.platform : requested;
const arch = requestedArch === 'native' ? process.arch : requestedArch;
const targets = { darwin: ['--mac', 'dmg', 'zip'], win32: ['--win', 'nsis', 'portable'], linux: ['--linux', 'AppImage', 'deb'] };
if (!targets[platform] || !['arm64', 'x64'].includes(arch) || !output.trim()) {
  console.error('Usage: node scripts/package.cjs native|darwin|win32|linux native|arm64|x64 <output-directory>');
  process.exit(1);
}
if (platform !== process.platform) {
  console.error(`Build ${platform} packages on ${platform}; this host is ${process.platform}. Native PTY modules require the target OS toolchain.`);
  process.exit(1);
}
function run(script, args) {
  const result = spawnSync(process.execPath, [script, ...args], { cwd: path.join(__dirname, '..'), stdio: 'inherit' });
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) process.exit(result.status || 1);
}
run(path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js'), ['build']);
run(path.join(path.dirname(require.resolve('electron-builder/package.json')), 'cli.js'), [...targets[platform], `--${arch}`, `--config.directories.output=${path.resolve(output)}`, '--publish', 'never']);
