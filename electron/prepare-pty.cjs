const fs = require('node:fs');
const path = require('node:path');

// Pin the source layout: a dependency upgrade must revalidate this native fix.
async function prepare(context) {
  if (process.platform !== 'darwin' || (context && context.platform.nodeName !== 'darwin')) return true;
  const root = path.dirname(require.resolve('node-pty/package.json'));
  if (require(path.join(root, 'package.json')).version !== '1.1.0') throw new Error('Revalidate Harbor PTY resource fix before upgrading node-pty');
  const source = path.join(root, 'src/unix/pty.cc');
  let code = fs.readFileSync(source, 'utf8');
  const signature = 'static void\npty_posix_spawn(char** argv';
  const declaration = code.indexOf(signature);
  let begin = code.indexOf(signature, declaration + 1);
  const marker = code.indexOf('// Harbor fix for node-pty 1.1.0:');
  if (marker >= 0 && marker < begin) begin = marker;
  const end = code.indexOf('\n#endif', begin);
  if (begin < 0 || end < 0 || !code.slice(begin, end).includes('posix_openpt')) throw new Error('Unknown node-pty macOS source layout');
  code = code.slice(0, begin) + fs.readFileSync(path.join(__dirname, 'native/pty-posix-spawn.inc'), 'utf8') + code.slice(end);
  code = code.replace('throw Napi::Error::New(napiEnv, "posix_spawnp failed.");', 'throw Napi::Error::New(napiEnv, std::string("PTY start failed: ") + strerror(err) + " (errno=" + std::to_string(err) + ")");');
  code = code.replace('throw Napi::Error::New(napiEnv, "Could not set master fd to nonblocking.");', 'close(master); throw Napi::Error::New(napiEnv, "Could not set master fd to nonblocking.");');
  // Avoid applying the nonblocking cleanup twice on repeated builds.
  code = code.replace('close(master); close(master);', 'close(master);');
  fs.writeFileSync(source, code);
  const { rebuild } = await import('@electron/rebuild');
  await rebuild({ buildPath: path.join(__dirname, '..'), electronVersion: require('electron/package.json').version, arch: context?.arch || process.arch, onlyModules: ['node-pty'], force: true, buildFromSource: true });
  fs.chmodSync(path.join(root, 'build/Release/spawn-helper'), 0o755);
  // Remove unpatched macOS fallbacks; packaging must use the rebuilt binary.
  for (const arch of ['arm64', 'x64']) fs.rmSync(path.join(root, 'prebuilds', `darwin-${arch}`), { recursive: true, force: true });
  return true;
}
module.exports = prepare;
if (require.main === module) prepare().catch(error => { console.error(error); process.exitCode = 1; });
