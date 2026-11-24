const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'harbor-selection-'));
  let app;
  try {
    app = await electron.launch({ ...(process.env.HARBOR_EXECUTABLE ? { executablePath: process.env.HARBOR_EXECUTABLE } : {}), args: [...(process.env.HARBOR_EXECUTABLE ? [] : ['.']), `--user-data-dir=${profile}`], env: { ...process.env, ZDOTDIR: profile, HARBOR_DEV: '0' } });
    const page = await app.firstWindow(); page.setDefaultTimeout(10000);
    await app.evaluate(async ({ app, clipboard, ipcMain }) => {
      global.selectionClipboard = await clipboard.read();
      global.selectionWrites = []; global.selectionAck = 0;
      ipcMain.on('session:ack', () => ++global.selectionAck);
      const pty = process.mainModule.require('node:module').createRequire(app.getAppPath() + '/package.json')('node-pty');
      global.selectionOriginalSpawn = pty.spawn;
      pty.spawn = (_file, _args, options) => {
        global.selectionDimensions = { cols: options.cols, rows: options.rows };
        return {
          onData: cb => { global.selectionOutput = cb; }, onExit: cb => { global.selectionExit = cb; },
          resize(cols, rows) { global.selectionDimensions = { cols, rows }; }, pause() {}, resume() {}, write: data => global.selectionWrites.push(data), kill: () => global.selectionExit({ exitCode: 0 })
        };
      };
      clipboard.writeText('ORIGINAL_CLIPBOARD');
    });
    await page.getByRole('button', { name: 'Open local terminal', exact: true }).click();
    const screen = page.locator('.terminal-pane.active .xterm-screen'); await screen.waitFor();
    const copy = page.getByRole('toolbar', { name: 'Terminal tools' }).getByRole('button', { name: 'Copy', exact: true });
    const output = async (text, background = false) => {
      const count = await app.evaluate(() => global.selectionAck);
      await app.evaluate((_, { text, background }) => (background ? global.backgroundSelectionOutput : global.selectionOutput)(text), { text, background });
      const deadline = Date.now() + 5000;
      while (await app.evaluate(() => global.selectionAck) === count) {
        if (Date.now() > deadline) throw new Error('Output not parsed');
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    };
    const remoteText = 'tmux / Claude selection 中文';
    const osc = text => `\x1b]52;c;${Buffer.from(text).toString('base64')}\x07`;
    await output('\x1b[?1049h\x1b[?1002h\x1b[?1006h\x1b[2J\x1b[HCLAUDE_COPY_FIXTURE');
    await output(osc(remoteText));
    await copy.waitFor();
    assert.equal(await copy.isEnabled(), true, 'remote OSC 52 selection must enable Copy');
    assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), 'ORIGINAL_CLIPBOARD', 'remote output alone must not overwrite the system clipboard');
    await copy.click();
    await page.waitForTimeout(80);
    assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), remoteText);
    console.log('PASS tmux OSC 52 selection enables explicit Copy without unsolicited clipboard writes');
    const box = await screen.boundingBox();
    const geometry = await page.evaluate(() => {
      const el = document.querySelector('.terminal-pane.active .xterm-screen');
      return { width: el.clientWidth, height: el.clientHeight };
    });
    // Resize IPC supplies the public terminal dimensions below.
    const dimensions = await app.evaluate(() => global.selectionDimensions);
    const cell = geometry.width / dimensions.cols, row = geometry.height / dimensions.rows;
    const drag = async (reverse = false) => {
      await page.mouse.move(box.x + cell * (reverse ? 20.1 : .1), box.y + row * .5);
      await page.mouse.down();
      await page.mouse.move(box.x + cell * (reverse ? .1 : 20.1), box.y + row * .5, { steps: 10 });
      await page.mouse.up();
    };
    await app.evaluate(() => { global.selectionWrites = []; });
    await drag();
    await copy.click(); await page.waitForTimeout(80);
    assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), 'CLAUDE_COPY_FIXTURE');
    assert.deepEqual(await app.evaluate(() => global.selectionWrites), [], 'local drag must not send mouse clicks to the remote program');
    await drag(true);
    await page.locator('.terminal-surface').click({ button: 'right', position: { x: cell * 10, y: row * .5 } });
    await page.getByRole('menuitem', { name: /^Copy/ }).click(); await page.waitForTimeout(80);
    assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), 'CLAUDE_COPY_FIXTURE');
    const input = page.locator('.terminal-pane.active .xterm-helper-textarea');
    await input.focus(); await page.keyboard.press(process.platform === 'darwin' ? 'Meta+c' : 'Control+Shift+c');
    assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), 'CLAUDE_COPY_FIXTURE');
    console.log('PASS plain forward/reverse drags in mouse-reporting alternate screen copy via toolbar, context menu and keyboard');
    await output('\x1b[?1002l\x1b[?1003h');
    await drag();
    assert.equal(await copy.isEnabled(), true);
    await app.evaluate(() => { global.selectionWrites = []; });
    await page.mouse.move(box.x + cell * 30, box.y + row * 3, { steps: 10 });
    assert.equal(await copy.isEnabled(), true, 'moving after a local drag must retain the selection in all-motion applications');
    const copyBox = await copy.boundingBox();
    await page.mouse.move(copyBox.x + copyBox.width / 2, copyBox.y + copyBox.height / 2, { steps: 10 });
    assert.equal(await copy.isEnabled(), true, 'the selection must survive moving to the toolbar');
    assert.deepEqual(await app.evaluate(() => global.selectionWrites), [], 'hover with a local selection must not send reports that clear it');
    await copy.click(); await page.waitForTimeout(80);
    assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), 'CLAUDE_COPY_FIXTURE');
    await input.focus(); await page.keyboard.type('x');
    assert.equal(await copy.isEnabled(), false, 'typing still clears the local selection');
    await app.evaluate(() => { global.selectionWrites = []; });
    await page.mouse.move(box.x + cell * 35, box.y + row * 4);
    const resumedMotion = await app.evaluate(async () => {
      const deadline = Date.now() + 2000;
      while (!global.selectionWrites.join('').includes('\x1b[<35;') && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
      return global.selectionWrites.join('');
    });
    assert.match(resumedMotion, /\x1b\[<35;/, 'hover reports resume when no local selection remains');
    await output('\x1b[?1003l\x1b[?1002h');
    console.log('PASS all-motion local selections survive pointer movement and toolbar copying; typing clears selection and restores reports');
    await app.evaluate(() => { global.selectionWrites = []; });
    await screen.click({ position: { x: cell * 3, y: row * 2 } });
    assert.match(await app.evaluate(() => global.selectionWrites.join('')), /\x1b\[</, 'single clicks still reach terminal applications');
    await page.getByRole('button', { name: 'Select text', exact: true }).click();
    await app.evaluate(() => { global.selectionWrites = []; });
    await drag();
    assert.match(await app.evaluate(() => global.selectionWrites.join('')), /\x1b\[</, 'application mode retains native mouse dragging');
    console.log('PASS single clicks and opt-in application mouse dragging remain available');
    await output('\x1b[?1002l\x1b[?1003h' + osc(remoteText));
    await page.mouse.move(box.x + cell * 5, box.y + row * 2);
    await copy.click(); await page.waitForTimeout(80);
    assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), remoteText, 'hovering toward Copy must not discard a remote selection');
    console.log('PASS all-motion mouse reports preserve remote selection while moving toward Copy');
    // Queries and malformed/oversized payloads must never expose or replace clipboard data.
    await input.focus(); await page.keyboard.type('x');
    await output('\x1b]52;c;?\x07\x1b]52;c;not base64!\x07\x1b]52;c;/w==\x07');
    assert.equal(await copy.isEnabled(), false);
    assert.ok(!(await app.evaluate(() => global.selectionWrites.join(''))).includes('ORIGINAL_CLIPBOARD'));
    console.log('PASS clipboard queries and invalid remote payloads are ignored');
    await output(osc('clear this selection'));
    assert.equal(await copy.isEnabled(), true);
    await output(osc(''));
    assert.equal(await copy.isEnabled(), false, 'an empty remote selection clears the previous copy candidate');
    await app.evaluate(() => { global.backgroundSelectionOutput = global.selectionOutput; });
    await page.getByRole('button', { name: 'New local terminal', exact: true }).click();
    await output('OTHER_TAB');
    await output(osc('BACKGROUND_SELECTION'), true);
    assert.equal(await copy.isEnabled(), false, 'background output cannot replace the active selection');
    await page.getByRole('tab', { name: 'Local terminal', exact: true }).first().click();
    assert.equal(await copy.isEnabled(), false, 'background OSC 52 was not cached');
    await page.getByRole('button', { name: 'Close Local terminal', exact: true }).last().click();
    await page.evaluate(() => window.harbor.enableSecurity({ password: 'selection-test-password', touchEnabled: false }));
    await page.evaluate(() => window.harbor.lock());
    await page.locator('.app-shell[aria-hidden=true]').waitFor({ state: 'attached' });
    await output(osc('LOCKED_SELECTION'), true);
    await page.evaluate(() => window.harbor.unlock({ method: 'password', password: 'selection-test-password' }));
    await page.locator('.app-shell:not([aria-hidden=true])').waitFor();
    assert.equal(await copy.isEnabled(), false, 'locked output cannot leave a copy candidate after unlock');
    console.log('PASS empty selections, inactive tabs and locked sessions do not leave stale remote copy data');
    if (process.platform !== 'win32') {
      const text = 'VIM_MOUSE_COPY_FIXTURE';
      const file = path.join(profile, 'vim-copy.txt');
      await fs.writeFile(file, text + '\n第二行 UTF-8\n');
      await page.getByRole('button', { name: 'Close Local terminal', exact: true }).click();
      await app.evaluate(({ app }, file) => {
        const pty = process.mainModule.require('node:module').createRequire(app.getAppPath() + '/package.json')('node-pty');
        global.selectionVimOutput = '';
        pty.spawn = (_file, _args, options) => {
          global.selectionDimensions = { cols: options.cols, rows: options.rows };
          const child = global.selectionOriginalSpawn('/usr/bin/vim', ['-Nu', 'NONE', '-n', '-i', 'NONE', '-c', 'set mouse=a', file], options);
          child.onData(data => { global.selectionVimOutput += data; });
          return child;
        };
      }, file);
      await page.getByRole('button', { name: 'New local terminal', exact: true }).click();
      const deadline = Date.now() + 10000;
      while (!(await app.evaluate(() => global.selectionVimOutput.includes('VIM_MOUSE_COPY_FIXTURE')))) {
        if (Date.now() > deadline) throw new Error('Vim did not render the fixture');
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      const box = await screen.boundingBox();
      const size = await app.evaluate(() => global.selectionDimensions);
      const cell = box.width / size.cols, row = box.height / size.rows;
      await page.mouse.move(box.x + cell * .1, box.y + row * .5); await page.mouse.down();
      await page.mouse.move(box.x + cell * (text.length + .1), box.y + row * .5, { steps: 10 }); await page.mouse.up();
      await copy.click(); await page.waitForTimeout(80);
      assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), text);
      await page.mouse.move(box.x + cell * 6.1, box.y + row * 1.5); await page.mouse.down();
      await page.mouse.move(box.x + cell * .1, box.y + row * 1.5, { steps: 10 }); await page.mouse.up();
      await input.focus(); await page.keyboard.press(process.platform === 'darwin' ? 'Meta+c' : 'Control+Shift+c');
      await page.waitForTimeout(80);
      assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), '第二行');
      await page.mouse.move(box.x + cell * .1, box.y + row * .5); await page.mouse.down();
      await page.mouse.move(box.x + cell * 6.1, box.y + row * 1.5, { steps: 10 }); await page.mouse.up();
      await copy.click(); await page.waitForTimeout(80);
      assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), text + '\n第二行');
      assert.equal(await fs.readFile(file, 'utf8'), text + '\n第二行 UTF-8\n');
      console.log('PASS actual Vim with mouse=a: ASCII, reversed Chinese and multiline drags copy without modifying the file');
    }

  } finally {
    if (app) { await app.evaluate(async ({ clipboard }) => { if (global.selectionClipboard) await clipboard.write(global.selectionClipboard); }).catch(() => {}); await app.close(); }
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
