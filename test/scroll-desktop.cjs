const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'harbor-scroll-'));
  let app;
  try {
    app = await electron.launch({ args: ['.', `--user-data-dir=${profile}`], env: { ...process.env, HARBOR_DEV: '0' } });
    const page = await app.firstWindow();
    await app.evaluate(({ ipcMain, BrowserWindow }) => {
      global.scrollWrites = []; global.scrollAck = 0; global.flushTimes = [];
      const web = BrowserWindow.getAllWindows()[0].webContents;
      const send = web.send.bind(web);
      web.send = (channel, ...args) => { if (channel === 'session:event' && args[0].type === 'data') global.flushTimes.push(performance.now()); return send(channel, ...args); };
      ipcMain.on('session:ack', () => { ++global.scrollAck; });
      process.mainModule.require(process.cwd() + '/node_modules/node-pty').spawn = () => ({
        onData: cb => { global.scrollOutput = cb; }, onExit: cb => { global.scrollExit = cb; },
        resize() {}, pause() {}, resume() {}, write: data => global.scrollWrites.push(data), kill: () => global.scrollExit({ exitCode: 0 })
      });
    });
    await page.getByRole('button', { name: 'Open local terminal', exact: true }).click();
    const screen = page.locator('.terminal-pane.active .xterm-screen');
    await screen.waitFor();
    const output = async data => {
      const count = await app.evaluate(() => global.scrollAck);
      const timing = await app.evaluate((_, data) => { const start = performance.now(); global.scrollOutput(data); return { start, delivered: global.flushTimes.at(-1) }; }, data);
      const deadline = Date.now() + 5000;
      while (await app.evaluate(() => global.scrollAck) === count) { if (Date.now() > deadline) throw Error('Output not parsed'); await new Promise(r => setTimeout(r, 10)); }
      return timing;
    };
    const timing = await output(Array.from({ length: 2000 }, (_, i) => `Scroll line ${i}\r\n`).join(''));
    assert.ok(timing.delivered >= timing.start, 'first output is sent synchronously, without batching delay');
    const wheel = async (deltaY, deltaMode = 1) => { await screen.dispatchEvent('wheel', { deltaY, deltaMode, bubbles: true, cancelable: true }); };
    await page.waitForTimeout(50);
    const slider = page.locator('.terminal-pane.active .scrollbar.vertical .slider');
    const before = await slider.getAttribute('style');
    const box = await screen.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const start = Date.now();
    await page.mouse.wheel(0, -300);
    await page.waitForFunction(before => document.querySelector('.terminal-pane.active .scrollbar.vertical .slider').getAttribute('style') !== before, before);
    console.log(`Local scroll viewport observed after ${Date.now() - start} ms (includes test-driver overhead)`);
    assert.deepEqual(await app.evaluate(() => global.scrollWrites), [], 'normal scrollback must not send remote keystrokes');
    await output('\x1b[?1049h\x1b[?1l\x1b[2Jvim fixture');
    await wheel(6);
    await page.waitForTimeout(50);
    assert.equal(await app.evaluate(() => global.scrollWrites.join('')), '\x1b[B'.repeat(6), 'preserve multi-line wheel distance');
    await app.evaluate(() => { global.scrollWrites = []; });
    await output('\x1b[?1h');
    await wheel(-3);
    await page.waitForTimeout(50);
    assert.equal(await app.evaluate(() => global.scrollWrites.join('')), '\x1bOA'.repeat(3), 'respect application cursor mode');
    await app.evaluate(() => { global.scrollWrites = []; });
    await output('\x1b[?1000h\x1b[?1006h');
    await wheel(3);
    await page.waitForTimeout(50);
    const mouse = await app.evaluate(() => global.scrollWrites.join(''));
    assert.ok(!mouse.includes('\x1bOB'), 'mouse-reporting applications retain their own protocol');
    await output('\x1b[?1000l\x1b[?1006l\x1b[?1049l');
    console.log('PASS immediate first output, local scrollback, multi-line full-screen scrolling, cursor modes and mouse-protocol isolation');
  } finally { if (app) await app.close(); await fs.rm(profile, { recursive: true, force: true }); }
})().catch(e => { console.error(e); process.exitCode = 1; });
