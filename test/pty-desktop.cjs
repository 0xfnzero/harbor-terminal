const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  if (process.platform === 'win32') { console.log('SKIP Unix PTY exit race fixture on Windows'); return; }
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'harbor-pty-race-'));
  let app;
  try {
    app = await electron.launch({ args: ['.', `--user-data-dir=${profile}`], env: { ...process.env, HARBOR_DEV: '0' } });
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }) => {
      global.ptyRaceErrors = []; global.closedResizeAttempts = 0;
      dialog.showErrorBox = (title, message) => global.ptyRaceErrors.push(`${title}: ${message}`);
      const pty = process.mainModule.require(process.cwd() + '/node_modules/node-pty');
      const spawn = pty.spawn;
      pty.spawn = (_file, _args, options) => {
        const child = spawn('/bin/sh', ['-c', 'printf READY; sleep 0.03'], options);
        let closed = false;
        child.onExit(() => { closed = true; });
        // Widen the real descriptor-close / app-onExit window deterministically.
        return new Proxy(child, { get(target, key) {
          if (key === 'onExit') return callback => target.onExit(event => setTimeout(() => callback(event), 150));
          if (key === 'resize') return (...size) => { if (closed) ++global.closedResizeAttempts; return target.resize(...size); };
          const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
        } });
      };
    });
    const result = await page.evaluate(async () => {
      const states = new Map(); const off = window.harbor.onEvent(event => { if (event.type === 'status') states.set(event.id, event.state); });
      const ids = Array.from({ length: 12 }, () => crypto.randomUUID());
      for (const id of ids) await window.harbor.openSession({ id, cols: 80, rows: 24 });
      const timer = setInterval(() => { for (const id of ids) window.harbor.resize(id, 100, 35); }, 5);
      try {
        const deadline = Date.now() + 5000;
        while (!ids.every(id => states.get(id) === 'exited') && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
        return ids.every(id => states.get(id) === 'exited');
      } finally { clearInterval(timer); for (const id of ids) await window.harbor.closeSession(id); off(); }
    });
    assert.equal(result, true, 'exit callbacks still complete normally');
    assert.ok(await app.evaluate(() => global.closedResizeAttempts > 0), 'exercise the real closed-FD resize path');
    assert.deepEqual(await app.evaluate(() => global.ptyRaceErrors), []);
    await page.getByRole('button', { name: 'Components', exact: true }).click();
    await page.getByRole('dialog', { name: 'Optional components · Mosh' }).waitFor();
    console.log('PASS repeated resize IPC during real PTY exit races; main process remains responsive');
  } finally { if (app) await app.close(); await fs.rm(profile, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
