const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
module.exports = async context => {
  if (context.electronPlatformName !== 'darwin') return;
  const executable = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents/MacOS', context.packager.appInfo.productFilename);
  // Test the signed bundle before creating archives, including direct builder
  // invocations. Check native resources, recovery and the clipboard bridge.
  try {
    for (const test of ['pty-resources-desktop.cjs', 'reconnect-desktop.cjs', 'selection-desktop.cjs', 'scroll-desktop.cjs', 'proxy-desktop.cjs']) {
      const result = await promisify(execFile)(process.execPath, [path.join(__dirname, '../test', test)], {
        cwd: path.join(__dirname, '..'), env: { ...process.env, HARBOR_EXECUTABLE: executable }, timeout: 180000,
      });
      process.stdout.write(result.stdout);
    }
  } catch (error) {
    throw new Error(`Packaged terminal checks failed: ${error.stdout || ''}${error.stderr || ''}${error.message}`);
  }
};
