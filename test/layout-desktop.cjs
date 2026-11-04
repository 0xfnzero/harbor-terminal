const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'harbor-layout-'));
  let app;
  try {
    await fs.writeFile(path.join(profile, 'sample.txt'), 'Harbor layout fixture\n'.repeat(300));
    app = await electron.launch({
      ...(process.env.HARBOR_EXECUTABLE ? { executablePath: process.env.HARBOR_EXECUTABLE } : {}),
      args: [...(process.env.HARBOR_EXECUTABLE ? [] : ['.']), `--user-data-dir=${profile}`], env: { ...process.env, HARBOR_DEV: '0', ZDOTDIR: profile, ...(process.platform === 'darwin' ? { SHELL: '/bin/zsh' } : {}) }
    });
    const page = await app.firstWindow(); page.setDefaultTimeout(10000);
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.evaluate(() => { window.layoutOutput = ''; window.harbor.onEvent(e => { if (e.type === 'data') window.layoutOutput += e.data; }); });
    await page.getByRole('button', { name: 'Open local terminal', exact: true }).click();
    const input = page.locator('.terminal-pane.active .xterm-helper-textarea');
    await input.waitFor({ state: 'attached' });
    await page.waitForFunction(() => window.layoutOutput.includes('❯') || window.layoutOutput.includes('[?2004h'));
    const command = async text => { await input.focus(); await page.keyboard.insertText(text); await page.keyboard.press('Enter'); };
    await command("printf 'LAYOUT_%s\\n' READY");
    await page.waitForFunction(() => window.layoutOutput.includes('LAYOUT_READY'));
    const geometry = () => page.evaluate(() => {
      const area = document.querySelector('.terminal-area'); const pane = document.querySelector('.terminal-pane.active');
      const surface = pane.querySelector('.terminal-surface'); const screen = pane.querySelector('.xterm-screen');
      return { inset: screen.getBoundingClientRect().x - area.getBoundingClientRect().x, padding: parseFloat(getComputedStyle(pane).paddingLeft), left: area.scrollLeft, top: area.scrollTop, surfaceLeft: surface.scrollLeft };
    });
    const aligned = async () => { const g = await geometry(); assert.ok(Math.abs(g.inset - g.padding) < 1, JSON.stringify(g)); assert.equal(g.left, 0); assert.equal(g.top, 0); assert.equal(g.surfaceLeft, 0); };
    await aligned();
    // Model a stale renderer size during resize/IME cursor auto-reveal. This
    // scrolled the previous overflow:hidden ancestor and left the first columns clipped.
    await page.evaluate(() => {
      const area = document.querySelector('.terminal-area'); const pane = document.querySelector('.terminal-pane.active');
      const screen = pane.querySelector('.xterm-screen'); const input = pane.querySelector('textarea');
      const screenStyle = screen.style.cssText, inputStyle = input.style.cssText;
      screen.style.width = area.clientWidth + 100 + 'px'; input.style.left = area.clientWidth + 80 + 'px'; input.style.width = '10px';
      input.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      screen.style.cssText = screenStyle; input.style.cssText = inputStyle;
    });
    await aligned();
    await page.keyboard.insertText('x'.repeat(400));
    for (const width of [920, 1500, 1050]) {
      await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 800), width);
      await page.waitForTimeout(100); await aligned();
    }
    await page.keyboard.press('Control+u');
    if (process.platform !== 'win32') {
      await command(`/usr/bin/vi -u NONE -n -R '${path.join(profile, 'sample.txt')}'`);
      await page.waitForFunction(() => window.layoutOutput.includes('[?1049h'));
      await page.keyboard.press('Escape'); await page.keyboard.insertText(':q!'); await page.keyboard.press('Enter');
      await page.waitForFunction(() => window.layoutOutput.includes('[?1049l'));
      await aligned();
    }
    await page.getByRole('button', { name: 'New local terminal', exact: true }).click();
    await page.getByRole('tab', { name: 'Local terminal', exact: true }).first().click(); await aligned();
    await command("printf 'LAYOUT_%s\\n' DONE");
    await page.waitForFunction(() => window.layoutOutput.includes('LAYOUT_DONE'));
    assert.deepEqual(errors, []);
    console.log('PASS terminal left inset survives cursor auto-reveal, long input, window resizing, vi exit and tab switching');
  } finally { if (app) await app.close(); await fs.rm(profile, { recursive: true, force: true }); }
})().catch(e => { console.error(e); process.exitCode = 1; });
