const { _electron: electron } = require('playwright');
const { mkdtemp, rm, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'harbor-test-'));
  await writeFile(path.join(profile, 'preferences.json'), JSON.stringify({ language: 'zh-CN' }));
  const launchOptions = {
    ...(process.env.HARBOR_EXECUTABLE ? { executablePath: process.env.HARBOR_EXECUTABLE } : {}),
    args: [...(process.env.HARBOR_EXECUTABLE ? [] : ['.']), `--user-data-dir=${profile}`],
    env: { ...process.env, HARBOR_DEV: '0' },
  };
  let app;
  try {
    app = await electron.launch(launchOptions);
    const page = await app.firstWindow();
    page.setDefaultTimeout(15000);
    async function selectOption(target, label, value) {
      await target.getByRole('combobox', { name: label, exact: true }).click();
      await target.locator(`[role=option][data-value="${value}"]`).click();
    }
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.getByText('每一次连接，都能继续。').waitFor();
    await page.screenshot({ path: path.join(os.tmpdir(), 'harbor-welcome.png') });
    await page.getByRole('button', { name: '添加第一台服务器' }).click();
    await page.getByLabel('连接名称', { exact: true }).fill('测试服务器');
    await page.getByLabel('主机地址 / SSH 别名', { exact: true }).fill('test.example.com');
    await page.getByRole('tab', { name: '网络与会话', exact: true }).click();
    await selectOption(page, '网络策略', 'tolerant');
    await page.getByLabel('SSH 压缩').check();
    await page.getByRole('button', { name: '保存连接' }).click();
    await page.getByTitle('连接 测试服务器', { exact: true }).waitFor();
    const saved = await page.evaluate(() => window.harbor.listServers());
    assert.equal(saved.length, 1);
    assert.equal(saved[0].persistent, true);
    assert.equal(saved[0].networkProfile, 'tolerant');
    assert.equal(saved[0].compression, true);
    await page.getByRole('button', { name: '打开本地终端', exact: true }).click();
    await page.getByText('本地会话', { exact: true }).waitFor();
    await page.evaluate(() => {
      window.outputTail = '';
      window.harbor.onEvent((event) => {
        if (event.type === 'data') window.outputTail = (window.outputTail + event.data).slice(-4096);
      });
    });
    const active = page.locator('.terminal-pane.active');
    // Use the real terminal keyboard path and wait for an actual command result.
    await active.locator('.xterm-helper-textarea').focus();
    await page.keyboard.insertText(process.platform === 'win32' ? "Write-Output ('HARBOR_' + 'PTY_OK')" : "printf 'HARBOR_%s\\n' 'PTY_OK'");
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.outputTail.includes('HARBOR_PTY_OK'));
    console.log('PASS actual local PTY input and output');
    const tabId = await page.evaluate(() => document.querySelector('[role=tab][aria-selected=true]')?.textContent);
    assert.ok(tabId.includes('本地终端'));
    const before = await app.evaluate(({ app }) => app.getAppMetrics().reduce((n, p) => n + p.memory.workingSetSize, 0));
    const start = Date.now();
    await page.keyboard.insertText(process.platform === 'win32' ? '1..100000 | ForEach-Object { "$_ harbor-output-throughput" }; Write-Output ("FLOOD_" + "DONE")' : "awk 'BEGIN {for(i=0;i<100000;i++) print i, \"harbor-output-throughput\"; print \"FLOOD_\" \"DONE\"}'");
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.outputTail.includes('FLOOD_DONE'), null, { timeout: 60000 });
    const elapsed = Date.now() - start;
    const after = await app.evaluate(({ app }) => app.getAppMetrics().reduce((n, p) => n + p.memory.workingSetSize, 0));
    console.log(JSON.stringify({ floodLines: 100000, elapsedMs: elapsed, allProcessesRssBeforeMB: Math.round(before / 1024), allProcessesRssAfterMB: Math.round(after / 1024) }));
    await page.getByRole('button', { name: '新建本地终端', exact: true }).click();
    assert.equal(await page.getByRole('tab').count(), 2);
    await page.locator('[role=tab]').first().click();
    assert.equal(await page.locator('.terminal-pane').count(), 2);
    await page.screenshot({ path: path.join(os.tmpdir(), 'harbor-terminal.png') });
    await page.getByRole('button', { name: '关闭 本地终端', exact: true }).first().click();
    assert.equal(await page.getByRole('tab').count(), 1);
    assert.deepEqual(errors, []);
    console.log('PASS server save, multiple tabs, retained terminal buffer, tab close');
    const net = require('node:net');
    let connections = 0;
    const broken = net.createServer(socket => { connections++; socket.destroy(); });
    await new Promise(resolve => broken.listen(0, '127.0.0.1', resolve));
    try {
      await page.getByRole('button', { name: '添加服务器', exact: true }).first().click();
      await page.getByLabel('连接名称', { exact: true }).fill('恢复测试');
      await page.getByLabel('主机地址 / SSH 别名', { exact: true }).fill('127.0.0.1');
      await page.getByLabel('端口', { exact: true }).fill(String(broken.address().port));
      await page.getByRole('button', { name: '保存连接' }).click();
      await page.getByTitle('连接 恢复测试', { exact: true }).click();
      await page.getByRole('button', { name: '暂停重连', exact: true }).click();
      await page.getByText('重连已暂停', { exact: true }).waitFor();
      const pausedCount = connections;
      await new Promise(resolve => setTimeout(resolve, 1400));
      assert.equal(connections, pausedCount, 'paused retry must not launch');
      await page.getByRole('button', { name: '重新连接', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('.session-toolbar [role=status]')?.textContent.includes('第 1 次重连'));
      assert.ok(connections > pausedCount, 'manual reconnect launched SSH');
      const preWake = connections;
      await app.evaluate(({ powerMonitor }) => powerMonitor.emit('resume'));
      await page.waitForFunction(() => document.querySelector('.session-toolbar [role=status]')?.textContent.includes('第 2 次重连'));
      assert.ok(connections > preWake, 'resume event resumes pending recovery');
      await page.getByRole('button', { name: '关闭 恢复测试', exact: true }).click();
      console.log('PASS retry countdown, pause, manual reconnect and simulated wake recovery');
      await page.getByRole('button', { name: '添加服务器', exact: true }).first().click();
      await page.getByLabel('连接名称', { exact: true }).fill('Mosh 回退');
      await page.getByLabel('主机地址 / SSH 别名', { exact: true }).fill('127.0.0.1');
      await page.getByLabel('端口', { exact: true }).fill(String(broken.address().port));
      await page.getByRole('tab', { name: '网络与会话', exact: true }).click();
      await page.getByRole('checkbox', { name: /^断线自动重连/ }).uncheck();
      await page.getByRole('tab', { name: '连接', exact: true }).click();
      await selectOption(page, '连接模式', 'mosh');
      await page.getByRole('tab', { name: '网络与会话', exact: true }).click();
      await selectOption(page, '预测回显', 'always');
      await page.getByLabel('Mosh UDP 端口', { exact: true }).fill('61042');
      await page.getByRole('button', { name: '保存连接', exact: true }).click();
      await page.getByRole('dialog', { name: '添加服务器', exact: true }).waitFor({ state: 'hidden' });
      const moshSaved = (await page.evaluate(() => window.harbor.listServers())).find(s => s.name === 'Mosh 回退');
      assert.equal(moshSaved.moshPort, 61042);
      assert.equal(moshSaved.moshPortEnd, 61042);
      assert.equal(moshSaved.prediction, 'always');
      await page.getByTitle('连接 Mosh 回退', { exact: true }).click();
      const beforeFallback = connections;
      await page.getByRole('button', { name: '改用 SSH', exact: true }).click();
      await page.getByRole('tab', { name: 'Mosh 回退 · SSH', exact: true }).waitFor();
      await page.getByRole('button', { name: '重新连接', exact: true }).waitFor();
      assert.ok(connections > beforeFallback, 'fallback launches system SSH');
      assert.equal((await page.evaluate(() => window.harbor.listServers())).find(s => s.name === 'Mosh 回退').transport, 'mosh', 'fallback does not overwrite saved mode');
      await page.getByRole('button', { name: '关闭 Mosh 回退 · SSH', exact: true }).click();
      await page.getByRole('button', { name: '关闭 Mosh 回退', exact: true }).click();
      console.log('PASS Mosh port/prediction settings and explicit SSH fallback');

    } finally { await new Promise(resolve => broken.close(resolve)); }
    await app.close(); app = null;
    app = await electron.launch(launchOptions);
    const reopened = await app.firstWindow();
    await reopened.getByTitle('连接 测试服务器', { exact: true }).waitFor();
    const restored = await reopened.evaluate(() => window.harbor.listServers());
    assert.equal(restored[0].networkProfile, 'tolerant');
    await reopened.getByRole('button', { name: '可选组件', exact: true }).click();
    await reopened.getByRole('heading', { name: '可选组件 · Mosh' }).waitFor();
    assert.equal(await reopened.getByRole('button', { name: '开始安装', exact: true }).isEnabled(), false);
    await selectOption(reopened, '安装位置', 'remote');
    await selectOption(reopened, '目标服务器', restored[0].id);
    assert.equal(await reopened.getByRole('checkbox', { name: /安装时配置服务器防火墙/ }).isChecked(), true);
    await reopened.getByRole('checkbox', { name: '我已了解安装位置及操作，允许安装所选组件' }).check();
    assert.equal(await reopened.getByRole('button', { name: '开始安装', exact: true }).isEnabled(), true);
    await reopened.getByRole('button', { name: '取消', exact: true }).click();
    console.log('PASS configuration restart and component installation consent UI');
    await reopened.getByRole('button', { name: '添加服务器', exact: true }).first().click();
    const dialog = reopened.getByRole('dialog', { name: '添加服务器', exact: true });
    const height = (await dialog.boundingBox()).height;
    await reopened.getByLabel('连接名称', { exact: true }).fill('AWS PEM 验收');
    await reopened.getByLabel('主机地址 / SSH 别名', { exact: true }).fill('ec2.example.com');
    await reopened.getByLabel('用户名', { exact: true }).fill('ec2-user');
    await reopened.getByRole('tab', { name: '认证', exact: true }).click();
    // Exercise the custom combobox keyboard path, including Escape without closing the dialog.
    const auth = reopened.getByRole('combobox', { name: '认证方式', exact: true });
    await auth.focus(); await reopened.keyboard.press('Enter'); await reopened.keyboard.press('ArrowDown'); await reopened.keyboard.press('Enter');
    await reopened.getByRole('button', { name: '保存连接', exact: true }).click();
    await reopened.getByRole('alert').filter({ hasText: '请选择用于登录的私钥' }).waitFor();
    await selectOption(reopened, '认证方式', 'key-password');
    await reopened.getByLabel('私钥 / PEM 文件', { exact: true }).fill('/tmp/harbor-test.pem');
    await reopened.getByRole('button', { name: '+ 配置 SSH 证书（可选）', exact: true }).click();
    await reopened.getByLabel('SSH 证书文件', { exact: true }).fill('/tmp/harbor-test-cert.pub');
    assert.ok(Math.abs((await dialog.boundingBox()).height - height) < 2, 'authentication tab preserves compact dialog height');
    await auth.click(); await reopened.keyboard.press('Escape');
    assert.equal(await dialog.isVisible(), true);
    await reopened.getByRole('button', { name: '保存连接', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    const pem = await reopened.evaluate(async () => { const s = (await window.harbor.listServers()).find(s => s.name === 'AWS PEM 验收'); return window.harbor.getServer(s.id); });
    assert.equal(pem.authMode, 'key-password');
    assert.equal(pem.identityFile, '/tmp/harbor-test.pem');
    assert.equal(pem.certificateFile, '/tmp/harbor-test-cert.pub');
    console.log('PASS compact server tabs, custom select keyboard, PEM + password and SSH certificate settings');
  } catch (error) {
    if (app) {
      const page = await app.firstWindow();
      await page.screenshot({ path: path.join(os.tmpdir(), 'harbor-test-failure.png') }).catch(() => {});
      console.error(await page.locator('body').innerText().catch(() => 'Cannot read page'));
    }
    throw error;
  } finally {
    if (app) await app.close();
    await rm(profile, { recursive: true, force: true });
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
