const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const { sshArgs, validateServer } = require('../electron/core.cjs');
const quote = text => "'" + text.replaceAll("'", "'\\''") + "'";
(async () => {
  if (process.platform === 'win32') { console.log('SKIP native tmux scroll fixture on Windows'); return; }
  const remote = process.env.HARBOR_TMUX_TEST_SSH;
  const shell = (command, input) => execFileSync(remote ? '/usr/bin/ssh' : '/bin/sh', remote ? ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=12', remote, command] : ['-c', command], { input, encoding: 'utf8', timeout: 20000, maxBuffer: 2097152 });
  let binary;
  try { binary = shell('command -v tmux').trim(); }
  catch (error) { if (remote) throw error; console.log('SKIP native tmux scroll fixture: install tmux or set HARBOR_TMUX_TEST_SSH'); return; }
  const fixture = shell('mktemp -d /tmp/harbor-tmux-scroll.XXXXXX').trim();
  assert.match(fixture, /^\/tmp\/harbor-tmux-scroll\.[a-zA-Z0-9]+$/);
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'harbor-tmux-scroll-ui-'));
  const session = 'harbor-abcd-1234';
  const tmux = (...args) => shell([quote(fixture + '/bin/tmux'), ...args.map(quote)].join(' ')).trim();
  let app;
  try {
    shell('mkdir ' + quote(fixture + '/bin'));
    shell('cat > ' + quote(fixture + '/bin/tmux') + ' && chmod 700 ' + quote(fixture + '/bin/tmux'), '#!/bin/sh\nexec ' + quote(binary) + ' -S ' + quote(fixture + '/socket') + ' -f /dev/null "$@"\n');
    shell('cat > ' + quote(fixture + '/output.txt'), Array.from({ length: 6000 }, (_, i) => `CAT_SCROLL_${String(i).padStart(5, '0')}\n`).join(''));
    // This unrelated session keeps the isolated server alive and proves that
    // Harbor does not modify global or other sessions' preferences.
    tmux('new-session', '-d', '-s', 'unrelated', '/bin/sh');
    tmux('set-option', '-g', 'default-shell', '/bin/sh');
    const command = 'export PATH=' + quote(fixture + '/bin') + ':"$PATH"; ' + sshArgs(validateServer({ name: 'scroll fixture', host: 'fixture.invalid', persistent: true }), session).at(-1);
    const start = async () => {
      app = await electron.launch({ ...(process.env.HARBOR_EXECUTABLE ? { executablePath: process.env.HARBOR_EXECUTABLE } : {}), args: [...(process.env.HARBOR_EXECUTABLE ? [] : ['.']), `--user-data-dir=${profile}`], env: { ...process.env, ZDOTDIR: profile, HARBOR_DEV: '0' } });
      const page = await app.firstWindow(); page.setDefaultTimeout(15000);
      await app.evaluate(({ app }, { remote, command }) => {
        const pty = process.mainModule.require('node:module').createRequire(app.getAppPath() + '/package.json')('node-pty');
        const spawn = pty.spawn;
        global.tmuxScrollOutput = '';
        pty.spawn = (_file, _args, options) => {
          const child = remote ? spawn('/usr/bin/ssh', ['-tt', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=12', remote, command], options) : spawn('/bin/sh', ['-c', command], options);
          child.onData(data => { global.tmuxScrollOutput = (global.tmuxScrollOutput + data).slice(-32768); });
          return child;
        };
      }, { remote, command });
      await page.getByRole('button', { name: 'New local terminal', exact: true }).click();
      return page;
    };
    const state = () => tmux('display-message', '-p', '-t', session, '#{mouse}:#{history-limit}:#{pane_id}:#{pane_in_mode}:#{scroll_position}:#{history_size}').split(':');
    const wait = async predicate => {
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline) {
        try { if (predicate()) return; } catch {}
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      throw new Error('tmux state timed out: ' + await app.evaluate(() => global.tmuxScrollOutput));
    };
    let page = await start();
    await wait(() => state()[0] === '1' && state()[1] === '50000');
    const pane = state()[2];
    await page.locator('.terminal-pane.active .xterm-helper-textarea').focus();
    await page.keyboard.insertText('cat ' + quote(fixture + '/output.txt')); await page.keyboard.press('Enter');
    await wait(() => Number(state()[5]) > 5500);
    assert.ok(tmux('capture-pane', '-p', '-t', session, '-S', '-').includes('CAT_SCROLL_00000'), 'more than the old 2000-line history must remain available');
    const screen = page.locator('.terminal-pane.active .xterm-screen');
    const box = await screen.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -600); await page.waitForTimeout(100); await page.mouse.wheel(0, -600);
    await wait(() => state()[3] === '1' && Number(state()[4]) > 0);
    await page.keyboard.press('Escape');
    await wait(() => state()[3] === '0');
    assert.equal(tmux('display-message', '-p', '-t', 'unrelated', '#{mouse}:#{history-limit}'), '0:2000');
    assert.equal(tmux('show-options', '-gv', 'mouse'), 'off');
    assert.equal(tmux('show-options', '-gv', 'history-limit'), '2000');
    console.log('PASS actual cat of 6000 lines in real tmux: history retained, actual wheel enters copy-mode and scrolls upward, Escape resumes the shell; unrelated session unchanged');
    await app.close(); app = null;
    tmux('set-option', '-t', session, 'mouse', 'off');
    tmux('set-option', '-t', session, 'history-limit', '60000');
    page = await start();
    await wait(() => state()[0] === '1' && state()[1] === '60000');
    assert.equal(state()[2], pane, 'reattach must preserve the running pane');
    assert.ok(tmux('capture-pane', '-p', '-t', session, '-S', '-').includes('CAT_SCROLL_00000'));
    console.log('PASS reattach restores mouse scrolling, retains the same shell/history and preserves a larger custom history limit');
  } finally {
    if (app) await app.close();
    try { tmux('kill-server'); } catch {}
    shell('rm -rf -- ' + quote(fixture));
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
