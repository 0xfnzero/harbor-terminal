const { t: tr, getLanguage, setLanguage, validateLanguage } = require('./locale.cjs');
const { app, BrowserWindow, ipcMain, dialog, powerMonitor, safeStorage, systemPreferences, Menu, clipboard, ClipboardItem, shell } = require('electron');
const pty = require('node-pty');
const { ProtectedClipboard, defaults: privacyDefaults, validate: validatePrivacy } = require('./protected-clipboard.cjs');
const { styledShell } = require('./shell-style.cjs');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { validateServer, retryDelay, canRetry } = require('./core.cjs');
const { capabilities, sessionCommand } = require('./transport.cjs');
const { defaults, validateAppearance } = require('./appearance.cjs');

let win;
const { Vault, atomicWrite } = require('./vault.cjs');
let languageQueue = Promise.resolve();
let vault;
let lastActivity = Date.now();
let securityBusy = false;
let pendingLock = false;
let appearance = defaults();
let appearanceQueue = Promise.resolve();
let inputPrivacy = privacyDefaults();
let privacyQueue = Promise.resolve();
const protectedClipboard = new ProtectedClipboard(clipboard, ClipboardItem, { guard: () => assertAccess() });
function updateSecureKeyboard() {
  if (process.platform === 'darwin') app.setSecureKeyboardEntryEnabled(Boolean(inputPrivacy.secureKeyboard && win?.isFocused()));
}
function privacyState() { return { ...inputPrivacy, secureKeyboardSupported: process.platform === 'darwin', secureKeyboardActive: process.platform === 'darwin' && app.isSecureKeyboardEntryEnabled() }; }
const sessions = new Map();
const runtimeFile = () => path.join(app.getPath('userData'), 'mosh-runtime.json');
const configFile = () => path.join(app.getPath('userData'), 'servers.json');
const emit = (event) => { if (win && !win.isDestroyed()) win.webContents.send('session:event', event); };
const status = (s, state, extra = {}) => { s.state = state; emit({ id: s.id, type: 'status', state, ...extra }); };

function securityState() { return pendingLock ? { ...vault.state(), enabled: true, locked: true } : vault.state(); }
function publishSecurity() { if (win && !win.isDestroyed()) win.webContents.send('security:changed', securityState()); }
function lockVault() {
  protectedClipboard.clear().catch(() => {});
  if (securityBusy) { pendingLock = true; publishSecurity(); return; }
  vault.lock();
  if (vault.state().locked) {
    publishSecurity();
  }
}
function assertAccess() { if (securityBusy) throw new Error(tr("安全配置正在更新，请稍后重试")); vault.assertUnlocked(); lastActivity = Date.now(); }
function sessionServer(s) { return s.serverBox ? vault.readSession(s.serverBox) : null; }
function sessionSummary(s) {
  const server = sessionServer(s);
  if (!server) return { id: s.id, server: null };
  const { identityFile, certificateFile, ...summary } = server;
  return { id: s.id, server: summary };
}

function flush(s) {
  clearTimeout(s.flushTimer);
  s.flushTimer = null;
  if (!s.output) return;
  const data = s.output;
  s.output = '';
  emit({ id: s.id, type: 'data', data, generation: s.generation });
}

function launch(s) {
  clearTimeout(s.retryTimer);
  s.retryTimer = null;
  s.retryAt = null;
  s.stopped = false;
  s.pending = 0;
  const generation = ++s.generation;
  status(s, s.purpose ? 'installing' : s.serverBox ? 'connecting' : 'local');
  try {
    let command = sessionCommand(s.serverBox ? vault.readSessionForReconnect(s.serverBox) : null, s.remoteName, s.purpose, runtimeFile(), s.configureNetwork, s.component);
    if (!s.serverBox && !s.purpose && appearance.shellStyle) command = styledShell(command, path.join(app.getPath('userData'), 'shell-style'));
    const { executable, args, env: commandEnv } = command;
    s.pty = pty.spawn(executable, args, {
      name: 'xterm-256color', cols: s.cols, rows: s.rows,
      cwd: os.homedir(), env: { ...process.env, ...commandEnv, PATH: [path.dirname(executable), process.env.PATH, '/usr/bin', '/bin'].filter(Boolean).join(path.delimiter), TERM: 'xterm-256color', COLORTERM: 'truecolor' },
    });
  } catch (error) {
    status(s, 'error', { message: error.message });
    return;
  }
  s.startedAt = Date.now();
  // SSH itself handles authentication and host-key confirmation in the terminal.
  // An alive ssh process is not proof of a completed login.
  s.pty.onData((data) => {
    if (s.generation !== generation) return;
    if (s.state === 'connecting') status(s, s.transport === 'mosh' ? 'mosh' : 'running');
    s.output += data;
    s.pending += data.length;
    if (s.output.length >= 32768) flush(s);
    else if (!s.flushTimer) s.flushTimer = setTimeout(() => flush(s), 8);
    // Bound the IPC + renderer queue even while a hidden tab receives huge logs.
    if (s.pending > 262144) s.pty?.pause();
  });
  s.pty.onExit(({ exitCode }) => {
    if (s.generation !== generation) return;
    flush(s);
    s.pty = null;
    if (Date.now() - s.startedAt > 60000) s.attempt = 0;
    if (!s.purpose && canRetry(s.serverBox ? { autoReconnect: s.autoReconnect, transport: s.transport } : null, exitCode, s.stopped)) {
      const delay = retryDelay(s.attempt++);
      s.retryAt = Date.now() + delay;
      status(s, 'retrying', { delay, retryAt: s.retryAt, attempt: s.attempt, exitCode });
      s.retryTimer = setTimeout(() => launch(s), delay);
    } else status(s, s.purpose ? (exitCode === 0 ? 'installed' : s.purpose === 'check-remote' && exitCode === 69 ? 'component-missing' : exitCode === 72 && s.purpose === 'install-remote' ? 'network-required' : exitCode === 75 && process.platform === 'win32' && s.purpose === 'install-local' ? 'restart-required' : 'install-failed') : 'exited', { exitCode });
  });
}

function stop(s) {
  s.stopped = true;
  ++s.generation;
  clearTimeout(s.retryTimer);
  clearTimeout(s.flushTimer);
  s.retryTimer = s.flushTimer = null;
  s.output = '';
  s.pty?.kill();
  s.pty = null;
}

function refreshMenu() {
  const item = (role, label) => ({ role, label: tr(label) });
  const edit = (action, label, key) => ({ label: tr(label), accelerator: process.platform === 'darwin' ? `Command+${key}` : `Control+Shift+${key}`, click: () => win?.webContents.send('terminal:edit', action) });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ label: 'Harbor', submenu: [item('about', '关于 Harbor'), { type: 'separator' }, item('hide', '隐藏 Harbor'), item('hideOthers', '隐藏其他应用'), item('unhide', '显示全部'), { type: 'separator' }, item('quit', '退出 Harbor')] }] : []),
    { label: tr('文件'), submenu: [item('close', '关闭窗口'), ...(process.platform !== 'darwin' ? [item('quit', '退出 Harbor')] : [])] },
    { label: tr('编辑'), submenu: [item('undo', '撤销'), item('redo', '重做'), { type: 'separator' }, item('cut', '剪切'), edit('copy', '复制', 'C'), edit('paste', '粘贴', 'V'), edit('selectAll', '全选', 'A')] },
    { label: tr('视图'), submenu: [item('reload', '重新加载'), item('forceReload', '强制重新加载'), item('toggleDevTools', '开发者工具'), { type: 'separator' }, item('resetZoom', '实际大小'), item('zoomIn', '放大'), item('zoomOut', '缩小'), item('togglefullscreen', '全屏')] },
    { label: tr('窗口'), submenu: [item('minimize', '最小化'), item('zoom', '缩放窗口'), ...(process.platform === 'darwin' ? [item('front', '全部置于前面')] : [])] },
  ]));
}

function registerIPC() {
  // Only our own local main frame may use the terminal bridge.
  const trusted = (event) => {
    if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error('Untrusted renderer');
  };
  const handle = (name, fn) => ipcMain.handle(name, (event, ...args) => { trusted(event); return fn(...args); });
  const on = (name, fn) => ipcMain.on(name, (event, ...args) => { trusted(event); fn(...args); });
  handle('terminal:edit-text', action => {
    if (action === 'copy') assertAccess();
    if (['copy', 'paste', 'selectAll'].includes(action)) win?.webContents[action]();
  });
  handle('input-privacy:get', () => privacyState());
  handle('input-privacy:save', input => {
    assertAccess();
    const next = validatePrivacy(input);
    const result = privacyQueue.then(async () => {
      assertAccess();
      await protectedClipboard.clear();
      assertAccess();
      await atomicWrite(path.join(app.getPath('userData'), 'input-privacy.json'), next);
      inputPrivacy = next; updateSecureKeyboard(); return privacyState();
    });
    privacyQueue = result.catch(() => {}); return result;
  });
  handle('clipboard:copy', text => {
    assertAccess();
    if (typeof text !== 'string' || text.length > 1048576) throw new Error(tr('文本过长，最多支持 1 MB'));
    return protectedClipboard.copy(text, inputPrivacy);
  });
  handle('clipboard:paste', async supplied => {
    assertAccess();
    const text = supplied === undefined ? await protectedClipboard.read() : supplied;
    assertAccess();
    if (typeof text !== 'string' || text.length > 1048576) throw new Error(tr('文本过长，最多支持 1 MB'));
    return text;
  });
  handle('terminal:link', url => {
    assertAccess();
    if (typeof url !== 'string' || url.length > 8192 || !/^https?:\/\//i.test(url)) return;
    return shell.openExternal(new URL(url).href);
  });
  handle('language:get', () => getLanguage());
  handle('language:set', input => {
    const next = validateLanguage(input);
    const result = languageQueue.then(async () => {
      await atomicWrite(path.join(app.getPath('userData'), 'preferences.json'), { language: next });
      setLanguage(next); refreshMenu(); return next;
    });
    languageQueue = result.catch(() => {}); return result;
  });
  handle('appearance:get', () => appearance);
  handle('appearance:save', (input) => {
    const next = validateAppearance(input);
    const result = appearanceQueue.then(async () => {
      const file = path.join(app.getPath('userData'), 'appearance.json');
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file + '.tmp', JSON.stringify(next, null, 2), { mode: 0o600 });
      await fs.rename(file + '.tmp', file);
      appearance = next;
      return next;
    });
    appearanceQueue = result.catch(() => {});
    return result;
  });
  handle('transport:capabilities', () => capabilities(runtimeFile()));
  handle('security:get', () => securityState());
  handle('security:enable', async ({ password, ...settings }) => {
    assertAccess();
    securityBusy = true;
    try {
      await vault.enable(password, settings);
      lastActivity = Date.now();
    } finally {
      securityBusy = false;
      if (pendingLock) { pendingLock = false; lockVault(); }
      publishSecurity();
    }
    return securityState();
  });
  handle('security:configure', async ({ password, newPassword, ...settings }) => {
    assertAccess(); await vault.configure(password, settings, newPassword); publishSecurity(); return securityState();
  });
  handle('security:unlock', async ({ method, password }) => {
    if (securityBusy) throw new Error(tr("安全配置正在更新，请稍后重试"));
    await vault.unlock(method, password); lastActivity = Date.now(); publishSecurity();
    return securityState();
  });
  handle('security:lock', () => { lockVault(); return securityState(); });
  on('security:activity', () => { if (!vault.state().locked) lastActivity = Date.now(); });
  handle('servers:list', () => { assertAccess(); return vault.summaries(); });
  handle('servers:get', (id) => { assertAccess(); return vault.get(id); });
  handle('session:list', () => { assertAccess(); return [...sessions.values()].map(sessionSummary); });
  handle('servers:save', (input) => {
    assertAccess();
    const s = validateServer(input);
    return vault.mutate((list) => list.some((item) => item.id === s.id) ? list.map((item) => item.id === s.id ? s : item) : [...list, s]);
  });
  handle('servers:delete', (id) => { assertAccess(); return vault.mutate((list) => list.filter((s) => s.id !== id)); });
  handle('key:choose', async (kind) => {
    assertAccess();
    const result = await dialog.showOpenDialog(win, { title: kind === 'certificate' ? tr("选择 SSH 证书") : tr("选择私钥 / PEM 文件"), defaultPath: path.join(os.homedir(), '.ssh'), properties: ['openFile', 'showHiddenFiles'] });
    assertAccess();
    return result.canceled ? null : result.filePaths[0];
  });
  handle('session:open', ({ id, serverId, cols, rows, purpose, modeOverride, configureNetwork, installUsername, component = 'mosh' }) => {
    assertAccess();
    if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id) || sessions.has(id) || sessions.size >= 32) throw new Error(tr("无法创建标签页（最多 32 个）"));
    if (modeOverride !== undefined && modeOverride !== 'ssh') throw new Error(tr("无效的连接模式"));
    if (purpose !== undefined && !['install-local', 'install-remote', 'check-remote'].includes(purpose)) throw new Error(tr("无效的组件操作"));
    if (!['mosh', 'tmux'].includes(component) || (component === 'tmux' && !['install-remote', 'check-remote'].includes(purpose)) || (purpose === 'check-remote' && component !== 'tmux')) throw new Error(tr("无效的组件操作"));
    if (['install-remote', 'check-remote'].includes(purpose) && !serverId) throw new Error(tr("请选择服务器"));
    const server = serverId ? vault.get(serverId) : null;
    if (serverId && !server) throw new Error(tr("服务器配置不存在"));
    const installServer = purpose === 'install-remote' && installUsername && installUsername !== server?.username ? validateServer({ ...server, username: installUsername, authMode: 'auto', identityFile: '', certificateFile: '' }) : server;
    const connection = installServer ? { ...installServer, ...(modeOverride ? { transport: modeOverride } : {}) } : null;
    const s = { id, purpose, component, configureNetwork: configureNetwork !== false, serverBox: connection ? vault.sealSession(connection) : null, transport: connection?.transport, autoReconnect: connection?.autoReconnect, remoteName: 'harbor-' + crypto.randomUUID(), cols: clamp(cols, 80), rows: clamp(rows, 24), output: '', pending: 0, attempt: 0, generation: 0 };
    sessions.set(id, s);
    launch(s);
    return { remoteName: s.remoteName };
  });
  handle('session:close', (id) => { assertAccess(); const s = sessions.get(id); if (s) { stop(s); vault.releaseSession(s.serverBox); sessions.delete(id); } });
  handle('session:pause-retry', (id) => {
    assertAccess();
    const s = sessions.get(id);
    if (!s || s.state !== 'retrying' || s.pty) return;
    clearTimeout(s.retryTimer);
    s.retryTimer = null;
    s.retryAt = null;
    status(s, 'paused');
  });
  handle('session:reconnect', (id) => {
    assertAccess();
    const s = sessions.get(id);
    if (!s || s.pty) return;
    s.attempt = 0;
    launch(s);
  });
  on('session:input', (id, data) => { if (!securityBusy && !vault.state().locked && typeof data === 'string' && data.length <= 1048576) { lastActivity = Date.now(); sessions.get(id)?.pty?.write(data); } });
  on('session:resize', (id, cols, rows) => {
    const s = sessions.get(id);
    if (s) { s.cols = clamp(cols, 80); s.rows = clamp(rows, 24); s.pty?.resize(s.cols, s.rows); }
  });
  on('session:ack', (id, length, generation) => {
    const s = sessions.get(id);
    if (s && generation === s.generation && Number.isInteger(length) && length > 0) {
      s.pending = Math.max(0, s.pending - length);
      if (s.pending < 65536) s.pty?.resume();
    }
  });
}
function clamp(value, fallback) { return Number.isInteger(value) ? Math.max(2, Math.min(value, 1000)) : fallback; }

app.whenReady().then(async () => {
  try { inputPrivacy = validatePrivacy(JSON.parse(await fs.readFile(path.join(app.getPath('userData'), 'input-privacy.json'), 'utf8'))); }
  catch (error) { if (error.code !== 'ENOENT') dialog.showErrorBox(tr('输入保护配置读取失败'), error.message); }
  try { setLanguage(JSON.parse(await fs.readFile(path.join(app.getPath('userData'), 'preferences.json'), 'utf8')).language); }
  catch (error) { if (error.code !== 'ENOENT') dialog.showErrorBox(tr('语言配置读取失败'), error.message); }
  refreshMenu();
  vault = new Vault(configFile(), { safeStorage, systemPreferences });
  try { await vault.load(); }
  catch (error) {
    if (error.code !== 'ENOENT') {
      dialog.showErrorBox(tr("服务器配置读取失败"), tr("原始文件已保留，请检查 {0}\n{1}", [configFile(), error.message]));
      app.quit();
      return;
    }
  }
  try { appearance = validateAppearance(JSON.parse(await fs.readFile(path.join(app.getPath('userData'), 'appearance.json'), 'utf8'))); }
  catch (error) {
    if (error.code !== 'ENOENT') dialog.showErrorBox(tr("外观配置读取失败"), tr("已使用默认外观，原文件已保留。\n{0}", [error.message]));
  }
  registerIPC();
  powerMonitor.on('lock-screen', lockVault);
  powerMonitor.on('suspend', lockVault);
  setInterval(() => {
    const state = vault.state();
    if (state.enabled && !state.locked && state.idleMinutes > 0 && (Date.now() - lastActivity >= state.idleMinutes * 60000 || powerMonitor.getSystemIdleTime() >= state.idleMinutes * 60)) lockVault();
  }, 5000).unref();
  // Resume pending recovery promptly; never replace a still-live SSH process.
  powerMonitor.on('resume', () => {
    for (const s of sessions.values()) {
      if (s.state === 'retrying' && !s.pty && !s.stopped) launch(s);
    }
  });
  function createWindow() {
    const icon = path.join(__dirname, '../assets/icon.png');
    if (process.platform === 'darwin') app.dock?.setIcon(icon);
    win = new BrowserWindow({ width: 1320, height: 860, minWidth: 920, minHeight: 600, title: 'Harbor Terminal', icon, backgroundColor: '#0e1118', ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 19, y: 22 } } : {}), webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
    win.on('focus', updateSecureKeyboard);
    win.on('blur', updateSecureKeyboard);
    updateSecureKeyboard();
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event) => event.preventDefault());
    if (!app.isPackaged && process.env.HARBOR_DEV === '1') win.loadURL('http://localhost:5173');
    else win.loadFile(path.join(__dirname, '../dist/index.html'));
    win.on('closed', () => { if (process.platform === 'darwin') app.setSecureKeyboardEntryEnabled(false); lockVault(); for (const s of sessions.values()) { stop(s); vault.releaseSession(s.serverBox); } sessions.clear(); win = null; });
  }
  createWindow();
  app.on('activate', () => { if (!win) createWindow(); });
});
let quitting = false;
app.on('before-quit', event => {
  if (process.platform === 'darwin') app.setSecureKeyboardEntryEnabled(false);
  if (!quitting) { event.preventDefault(); quitting = true; Promise.race([protectedClipboard.clear(), new Promise(resolve => setTimeout(resolve, 1000))]).catch(() => {}).finally(() => app.quit()); }
  vault?.dispose(); for (const s of sessions.values()) stop(s); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
