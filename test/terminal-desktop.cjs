const { _electron: electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'harbor-terminal-ui-'));
  let app;
  try {
    app = await electron.launch({ args: ['.', `--user-data-dir=${profile}`], env: { ...process.env, HARBOR_DEV: '0' } });
    const page = await app.firstWindow(); page.setDefaultTimeout(15000);
    await app.evaluate(async ({ clipboard }) => { global.harborClipboard = await clipboard.read(); });
    if (process.platform === 'darwin') {
      const protection = await app.evaluate(async ({ app, BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        win.focus(); await new Promise(resolve => setTimeout(resolve, 100));
        const focused = app.isSecureKeyboardEntryEnabled();
        win.blur(); await new Promise(resolve => setTimeout(resolve, 100));
        const blurred = app.isSecureKeyboardEntryEnabled();
        win.focus();
        return { focused, blurred };
      });
      assert.deepEqual(protection, { focused: true, blurred: false });
      console.log('PASS macOS secure keyboard entry follows window focus');
    }
    await page.getByRole('button', { name: 'Open local terminal', exact: true }).click();
    await page.evaluate(() => { window.terminalOutput = ''; window.harbor.onEvent(e => { if (e.type === 'data') window.terminalOutput += e.data; }); });
    const input = page.locator('.terminal-pane.active .xterm-helper-textarea');
    await input.focus();
    await page.keyboard.insertText(process.platform === 'win32' ? "Write-Output ('TERMINAL_' + 'FIXTURE')" : "printf 'TERMINAL_%s\\n' FIXTURE"); await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.terminalOutput.includes('TERMINAL_FIXTURE'));
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control+Shift';
    await page.keyboard.press(`${mod}+f`);
    await page.getByRole('textbox', { name: 'Search terminal', exact: true }).fill('TERMINAL_FIXTURE');
    await page.getByRole('button', { name: 'Next match', exact: true }).click();
    await input.focus();
    await page.keyboard.press(`${mod}+c`);
    assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), 'TERMINAL_FIXTURE');
    // Concurrent requests must paste the newly copied value, not the stale clipboard.
    const race = await page.evaluate(async () => {
      const write = window.harbor.copyText('ORDERED_CLIPBOARD');
      const paste = window.harbor.pasteText();
      await write;
      return paste;
    });
    assert.equal(race, 'ORDERED_CLIPBOARD');
    console.log('PASS search selection, keyboard copy and ordered clipboard writes');
    await page.getByRole('button', { name: 'Close search', exact: true }).click();
    // Verify shortcut paste travels through xterm exactly once.
    await app.evaluate(({ clipboard }) => clipboard.writeText(process.platform === 'win32' ? "Write-Output ('PASTE_' + 'ONCE')" : "printf 'PASTE_%s\\n' ONCE"));
    await input.focus(); await page.keyboard.press(`${mod}+v`);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.terminalOutput.includes('PASTE_ONCE'));
    await page.keyboard.press(`${mod}+a`); await page.keyboard.press(`${mod}+c`);
    const copied = await app.evaluate(({ clipboard }) => clipboard.readText());
    assert.ok(copied.includes('TERMINAL_FIXTURE')); assert.equal(copied.includes('Search connections'), false);
    // Test the actual application context menu with real clicks.
    await app.evaluate(({ clipboard }) => clipboard.writeText('CONTEXT_PASTE'));
    await page.locator('.terminal-surface').click({ button: 'right' });
    await page.getByRole('menuitem', { name: /^Paste/ }).click();
    await page.waitForFunction(() => window.terminalOutput.includes('CONTEXT_PASTE'));
    await page.keyboard.press('Control+u');
    await page.keyboard.press(`${mod}+f`);
    await page.getByRole('textbox', { name: 'Search terminal', exact: true }).fill('TERMINAL_FIXTURE');
    await page.getByRole('button', { name: 'Next match', exact: true }).click();
    await page.locator('.terminal-surface').click({ button: 'right' });
    await page.getByRole('menuitem', { name: /^Copy/ }).click();
    await page.waitForTimeout(100);
    assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), 'TERMINAL_FIXTURE');
    await page.getByRole('button', { name: 'Close search', exact: true }).click();
    console.log('PASS application context menu copy/paste and terminal-only select all');
    // A multiline paste must be reviewed; cancellation must not send it to the shell.
    await app.evaluate(({ clipboard }) => clipboard.writeText('echo MULTILINE_BLOCKED\necho SECOND_LINE'));
    await input.focus(); await page.keyboard.press(`${mod}+v`);
    await page.getByRole('dialog', { name: 'Confirm multiline paste' }).waitFor();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(await page.evaluate(() => window.terminalOutput.includes('MULTILINE_BLOCKED')), false);
    await input.focus(); await page.keyboard.insertText(process.platform === 'win32' ? 'Start-Sleep -Seconds 30' : 'sleep 30'); await page.keyboard.press('Enter');
    await page.keyboard.press('Control+c');
    await page.keyboard.insertText(process.platform === 'win32' ? "Write-Output ('INTERRUPT_' + 'OK')" : "printf 'INTERRUPT_%s\\n' OK"); await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.terminalOutput.includes('INTERRUPT_OK'));
    console.log('PASS multiline cancellation and Ctrl+C interrupt');
  } finally {
    if (app) { await app.evaluate(async ({ clipboard }) => { if (global.harborClipboard) await clipboard.write(global.harborClipboard); }).catch(() => {}); await app.close(); }
    await fs.rm(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
