const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
module.exports = async context => {
  if (context.electronPlatformName !== 'darwin') return;
  const executable = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents/MacOS', context.packager.appInfo.productFilename);
  // Test the signed bundle before creating archives, including direct builder
  // invocations. Refuse to package a native binary with the old resource leak.
  try {
    for (const test of ['pty-resources-desktop.cjs', 'reconnect-desktop.cjs']) {
      const result = await promisify(execFile)(process.execPath, [path.join(__dirname, '../test', test)], {
        cwd: path.join(__dirname, '..'), env: { ...process.env, HARBOR_EXECUTABLE: executable }, timeout: 180000,
      });
      process.stdout.write(result.stdout);
    }
  } catch (error) {
    throw new Error(`Packaged PTY resource check failed: ${error.stdout || ''}${error.stderr || ''}${error.message}`);
  }
};
