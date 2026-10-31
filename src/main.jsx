import { TerminalContextMenu, PasteDialog } from './terminal-overlays.jsx';
import { LanguageSwitch } from './language.jsx';
import { t as tr, useLanguage, initializeLanguage } from './i18n.jsx';
import { SecurityDialog, LockScreen } from './security.jsx';
import { Select } from './select.jsx';
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { terminalShortcut } from './terminal-actions.js';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';
import './style.css';
import { ComponentsDialog, InstallationPane } from './components.jsx';
import { AppearanceDialog, defaultAppearance, terminalOptions } from './appearance.jsx';

const api = window.harbor;
const isMac = navigator.platform.toLowerCase().includes('mac');
const tabShortcut = isMac ? '⌘ T' : 'Ctrl ⇧ T';
const labels = { starting: '正在启动', connecting: '正在连接', running: 'SSH 运行中', mosh: 'Mosh 运行中', local: '本地会话', paused: '重连已暂停', retrying: '等待重连', exited: '会话已结束', installed: '组件已就绪', 'network-required': '组件已安装，端口待配置', 'install-failed': '安装未完成', installing: '正在安装组件', 'restart-required': '需要重启电脑', error: '启动失败' };
const emptyServer = { name: '', host: '', username: '', port: 22, identityFile: '', certificateFile: '', authMode: 'auto', moshPort: 60042, moshPortEnd: 60042, transport: 'ssh', prediction: 'adaptive', networkProfile: 'balanced', compression: false, persistent: true, autoReconnect: true };

const networkLabels = { balanced: '均衡', tolerant: '弱网容错', responsive: '快速恢复' };
function RecoveryStatus({ tab }) {
  useLanguage();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (tab.state !== 'retrying') return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [tab.state, tab.retryAt]);
  return <span role="status">{tab.state === 'retrying' ? tr("第 {0} 次重连 · {1} 秒", [tab.attempt, Math.max(0, Math.ceil((tab.retryAt - now) / 1000))]) : tr(labels[tab.state])}</span>;
}

function Icon({ name, size = 18 }) {
  useLanguage();
  const paths = {
    terminal: <><path d="m5 6 5 6-5 6M13 18h6" /></>,
    server: <><rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 6.5h.01M7 17.5h.01M11 6.5h6M11 17.5h6"/></>,
    plus: <path d="M12 5v14M5 12h14"/>,
    close: <path d="m6 6 12 12M18 6 6 18"/>,
    arrow: <path d="M5 12h14m-6-6 6 6-6 6"/>,
    edit: <><path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14z"/></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,
    shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/><path d="m8 12 3 3 5-6"/></>,
    palette: <><circle cx="12" cy="12" r="9"/><circle cx="8" cy="9" r="1"/><circle cx="13" cy="7" r="1"/><circle cx="17" cy="11" r="1"/><path d="M8 16h4"/></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-1l2 6M4 12l2 6a7 7 0 0 0 12-1"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.terminal}</svg>;
}

function tabTitle(tab) {
  if (!tab) return tr('概览');
  if (tab.server && !tab.server.name) return tr('已锁定会话');
  if (tab.purpose) return tr('安装 Mosh · {0}', [tab.server?.name || tr('本机')]);
  return (tab.server?.name || tr('本地终端')) + (tab.modeOverride === 'ssh' ? ' · SSH' : '');
}

function TerminalPane({ tab, active, onStatus, appearance }) {
  useLanguage();
  const [contextMenu, setContextMenu] = useState(null);
  const [pastePreview, setPastePreview] = useState(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState(true);
  const [selected, setSelected] = useState(false);
  const [actionError, setActionError] = useState('');
  const searchInput = useRef(null);
  const searchRef = useRef(null);
  const actionRef = useRef(null);
  const el = useRef(null);
  const terminalRef = useRef(null);
  const fitRef = useRef(null);
  const webglRef = useRef(null);
  const activeRef = useRef(active);
  useEffect(() => { activeRef.current = active; }, [active]);
  useEffect(() => {
    const term = new Terminal({ ...terminalOptions(appearance), scrollback: 5000, allowProposedApi: false });
    const fit = new FitAddon();
    term.loadAddon(fit);
    const search = new SearchAddon();
    term.loadAddon(search);
    searchRef.current = search;
    term.loadAddon(new WebLinksAddon((event, url) => {
      if (event.metaKey || event.ctrlKey) api.openLink(url).catch(error => setActionError(error.message));
    }));
    term.open(el.current);
    terminalRef.current = term;
    fitRef.current = fit;
    fit.fit();
    let alive = true;
    let resizeFrame;
    const off = api.onEvent((event) => {
      if (event.id !== tab.id || !alive) return;
      if (event.type === 'data') term.write(event.data, () => api.ack(tab.id, event.data.length, event.generation));
      else {
        onStatus(tab.id, event);
        if (event.state === 'retrying') term.write(tr("\r\n\u001b[33m[Harbor] 连接中断，{0} 秒后进行第 {1} 次重连…\u001b[0m\r\n", [event.delay / 1000, event.attempt]));
        if (event.state === 'exited') term.write(tr("\r\n\u001b[90m[Harbor] 会话结束（退出码 {0}）。可点击右上角重新连接。\u001b[0m\r\n", [event.exitCode]));
        if (event.state === 'error') term.write(`\r\n[Harbor] ${event.message}\r\n`);
      }
    });
    const input = term.onData((data) => api.input(tab.id, data));
    const resize = term.onResize(({ cols, rows }) => api.resize(tab.id, cols, rows));
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => { if (activeRef.current && el.current?.clientWidth) fit.fit(); });
    });
    observer.observe(el.current);
    const allowed = () => alive && activeRef.current && !el.current?.closest('[aria-hidden=true]');
    let pasting = false;
    let pendingCopy = Promise.resolve();
    async function paste(supplied, confirmed = false) {
      if (pasting || !allowed()) return;
      pasting = true;
      try {
        await pendingCopy;
        if (!allowed()) return;
        const text = await api.pasteText(supplied);
        if (text !== null && allowed()) {
          if (!confirmed && /[\r\n]/.test(text)) setPastePreview(text);
          else { term.clearSelection(); term.paste(text); term.focus(); }
        }
      } catch (error) { if (alive) setActionError(error.message); }
      finally { pasting = false; }
    }
    async function action(name, supplied) {
      if (!allowed()) return;
      try {
        if (name === 'copy' && (supplied || term.hasSelection())) {
          const result = api.copyText(supplied || term.getSelection());
          pendingCopy = result.catch(() => {});
          await result;
        }
        if (name === 'paste') return paste();
        if (name === 'pasteConfirmed') return paste(supplied, true);
        if (name === 'selectAll') term.selectAll();
        if (name === 'clear') { term.clear(); search.clearDecorations(); }
        if (name === 'bottom') term.scrollToBottom();
        if (name === 'search') { setSearchOpen(true); return; }
        term.focus();
      } catch (error) { if (alive) setActionError(error.message); }
    }
    actionRef.current = action;
    const menuEdit = event => {
      if (allowed() && el.current?.contains(document.activeElement)) { event.preventDefault(); void action(event.detail); }
    };
    window.addEventListener('harbor-edit', menuEdit);
    const selection = term.onSelectionChange(() => setSelected(term.hasSelection()));
    const pasteEvent = event => { event.preventDefault(); event.stopImmediatePropagation(); void paste(); };
    const copyEvent = event => {
      if (!allowed() || !term.hasSelection()) return;
      event.preventDefault(); event.stopImmediatePropagation();
      void action('copy');
    };
    const contextMenu = event => {
      event.preventDefault(); event.stopPropagation();
      if (allowed()) setContextMenu({ x: event.clientX, y: event.clientY, selected: term.getSelection() });
    };
    const host = el.current;
    host.addEventListener('paste', pasteEvent, true);
    host.addEventListener('copy', copyEvent, true);
    host.addEventListener('contextmenu', contextMenu);
    term.attachCustomKeyEventHandler(event => {
      const name = terminalShortcut(event, isMac);
      if (name) {
        event.preventDefault();
        if (event.type === 'keydown') void action(name);
        return false;
      }
      return !((isMac ? event.metaKey : event.ctrlKey && event.shiftKey) && ['t', 'w'].includes(event.key.toLowerCase()));
    });
    api.openSession({ id: tab.id, serverId: tab.server?.id, purpose: tab.purpose, modeOverride: tab.modeOverride, cols: term.cols, rows: term.rows }).catch((error) => {
      if (alive) { onStatus(tab.id, { state: 'error', message: error.message }); term.write(`\r\n${error.message}\r\n`); }
    });
    if (activeRef.current) term.focus();
    return () => { alive = false; cancelAnimationFrame(resizeFrame); observer.disconnect(); off(); input.dispose(); resize.dispose(); selection.dispose(); window.removeEventListener('harbor-edit', menuEdit); host.removeEventListener('paste', pasteEvent, true); host.removeEventListener('copy', copyEvent, true); host.removeEventListener('contextmenu', contextMenu); term.dispose(); api.closeSession(tab.id).catch(() => {}); };
  }, []);
  useEffect(() => {
    if (active && terminalRef.current) {
      const term = terminalRef.current;
      let addon;
      try {
        addon = new WebglAddon();
        addon.onContextLoss(() => { addon.dispose(); webglRef.current = null; });
        term.loadAddon(addon);
        webglRef.current = addon;
      } catch { addon?.dispose(); }
      const frame = requestAnimationFrame(() => { fitRef.current.fit(); term.focus(); });
      // Only the active tab owns a GPU renderer; all terminal buffers stay alive.
      return () => { cancelAnimationFrame(frame); if (webglRef.current === addon) { addon?.dispose(); webglRef.current = null; } };
    }
  }, [active]);
  useEffect(() => {
    if (!terminalRef.current) return;
    terminalRef.current.options = terminalOptions(appearance);
    const frame = requestAnimationFrame(() => { if (activeRef.current) fitRef.current?.fit(); });
    return () => cancelAnimationFrame(frame);
  }, [appearance]);
  useEffect(() => { if (!active) { setContextMenu(null); setPastePreview(null); } }, [active]);
  useEffect(() => api.onSecurity(state => { if (state.locked) { setContextMenu(null); setPastePreview(null); } }), []);
  useEffect(() => { if (searchOpen && active) searchInput.current?.focus(); }, [searchOpen, active]);
  function find(previous = false) {
    if (!query) { searchRef.current?.clearDecorations(); setFound(true); return; }
    setFound(Boolean(searchRef.current?.[previous ? 'findPrevious' : 'findNext'](query)));
  }
  return <div style={{ background: appearance.colors.background }} className={`terminal-pane ${active ? 'active' : ''}`} aria-label={tr("{0}终端", [tabTitle(tab)])}>
    <div className="terminal-surface" ref={el}/>
    {contextMenu && active && <TerminalContextMenu position={contextMenu} selected={contextMenu.selected} mac={isMac} onClose={() => { setContextMenu(null); terminalRef.current?.focus(); }} onAction={name => { const text = contextMenu.selected; setContextMenu(null); actionRef.current?.(name, name === 'copy' ? text : undefined); }}/>}
    {pastePreview !== null && active && <PasteDialog text={pastePreview} onCancel={() => { setPastePreview(null); terminalRef.current?.focus(); }} onConfirm={() => { const text = pastePreview; setPastePreview(null); actionRef.current?.('pasteConfirmed', text); }}/>}
    <div className="terminal-tools" role="toolbar" aria-label={tr('终端工具')}>
      <button disabled={!selected} onClick={() => actionRef.current?.('copy')} title={isMac ? '⌘ C' : 'Ctrl Shift C'}>{tr('复制')}</button>
      <button onClick={() => actionRef.current?.('paste')} title={isMac ? '⌘ V' : 'Ctrl Shift V'}>{tr('粘贴')}</button>
      <button onClick={() => actionRef.current?.('search')} title={isMac ? '⌘ F' : 'Ctrl Shift F'}>{tr('搜索终端')}</button>
      <button onClick={() => actionRef.current?.('bottom')}>{tr('滚动到底部')}</button>
    </div>
    {searchOpen && <form className="terminal-search" onSubmit={event => { event.preventDefault(); find(); }} onKeyDown={event => {
      if (event.key === 'Escape') { event.stopPropagation(); setSearchOpen(false); searchRef.current?.clearDecorations(); terminalRef.current?.focus(); }
      if (event.key === 'Enter' && event.shiftKey) { event.preventDefault(); find(true); }
    }}>
      <input ref={searchInput} aria-label={tr('搜索终端')} placeholder={tr('搜索终端')} value={query} onChange={event => { setQuery(event.target.value); setFound(true); }}/>
      {!found && <span role="status">{tr('未找到匹配项')}</span>}
      <button type="button" onClick={() => find(true)} aria-label={tr('上一个匹配项')}>↑</button><button type="submit" aria-label={tr('下一个匹配项')}>↓</button>
      <button type="button" aria-label={tr('关闭搜索')} onClick={() => { setSearchOpen(false); searchRef.current?.clearDecorations(); terminalRef.current?.focus(); }}>×</button>
    </form>}
    {actionError && <div className="terminal-action-error" role="alert">{actionError}<button aria-label={tr('关闭')} onClick={() => setActionError('')}>×</button></div>}
  </div>;
}

const authLabels = { auto: '本机密钥 / SSH 配置', key: '私钥 / PEM 文件', 'key-password': '私钥 + 密码 / 验证码', password: '密码登录' };
function ServerDialog({ server, onClose, onSave, onDelete }) {
  useLanguage();
  const [form, setForm] = useState({ ...emptyServer, ...server });
  const [section, setSection] = useState('connection');
  const [error, setError] = useState('');
  const [capabilities, setCapabilities] = useState(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showCertificate, setShowCertificate] = useState(Boolean(server?.certificateFile));
  useEffect(() => { api.getCapabilities().then(setCapabilities).catch(() => setCapabilities({ mosh: false })); }, []);
  const set = (key, value) => setForm(prev => ({ ...prev, [key]: value }));
  async function submit(event) {
    event.preventDefault(); setError('');
    if (!form.name.trim() || !form.host.trim()) { setSection('connection'); setError(tr("请填写连接名称和主机地址")); return; }
    if (['key', 'key-password'].includes(form.authMode) && !form.identityFile.trim()) { setSection('auth'); setError(tr("请选择用于登录的私钥或 PEM 文件")); return; }
    setSaving(true);
    try { await onSave(form); } catch (e) { setError(e.message.replace(/^Error invoking remote method '[^']+': Error: /, '')); }
    finally { setSaving(false); }
  }
  async function choose(field, kind) { try { const file = await api.chooseKey(kind); if (file) set(field, file); } catch (e) { setError(e.message); } }
  useEffect(() => {
    const listener = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);
  const sections = [['connection', tr("连接")], ['auth', tr("认证")], ['network', tr("网络与会话")]];
  return <div className="modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <form className="modal server-modal" role="dialog" aria-modal="true" aria-labelledby="dialog-title" onSubmit={submit}>
      <div className="modal-heading"><div><div className="eyebrow">{tr("连接设置")}</div><h2 id="dialog-title">{server ? tr("编辑服务器") : tr("添加服务器")}</h2></div><button type="button" className="icon-button" aria-label={tr("关闭")} onClick={onClose}><Icon name="close"/></button></div>
      <div className="server-sections" role="tablist" aria-label={tr("服务器设置")}>{sections.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={section === id} aria-controls={`server-${id}`} id={`server-tab-${id}`} onClick={() => setSection(id)}>{label}</button>)}</div>
      <div className="server-form-body">
        {section === 'connection' && <div role="tabpanel" id="server-connection" aria-labelledby="server-tab-connection">
          <label>{tr("连接名称")}<input autoFocus maxLength={80} placeholder={tr("例如：生产服务器")} value={form.name} onChange={e => set('name', e.target.value)}/></label>
          <div className="form-row"><label className="host-field">{tr("主机地址 / SSH 别名")}<input placeholder={tr("192.168.1.100 或 my-server")} value={form.host} onChange={e => set('host', e.target.value)}/></label><label>{tr("端口")}<input aria-label={tr("端口")} type="number" min="1" max="65535" value={form.port} onChange={e => set('port', e.target.value)}/></label></div>
          <label>{tr("用户名 ")}<span className="optional">{tr("留空时使用 SSH 配置")}</span><input aria-label={tr("用户名")} placeholder={tr("例如 deploy")} value={form.username} onChange={e => set('username', e.target.value)}/></label>
          <label>{tr("连接模式")}<Select aria-label={tr("连接模式")} value={form.transport} onChange={e => set('transport', e.target.value)}><option value="ssh">{tr("SSH · 通用兼容")}</option><option value="mosh">{tr("Mosh · 弱网交互与预测回显")}</option></Select></label>
          <div className="connection-summary"><span>{tr(authLabels[form.authMode])}</span><span>{form.persistent ? tr("保留远程任务") : tr("普通会话")}</span>{form.transport === 'mosh' && <span>UDP {form.moshPort}{form.moshPortEnd !== form.moshPort ? `–${form.moshPortEnd}` : ''}</span>}</div>
          <p className="form-note">{tr("默认使用本机密钥免密连接。AWS PEM、密码或证书，请在「认证」中配置。")}</p>
        </div>}
        {section === 'auth' && <div role="tabpanel" id="server-auth" aria-labelledby="server-tab-auth">
          <label>{tr("认证方式")}<Select aria-label={tr("认证方式")} value={form.authMode} onChange={e => set('authMode', e.target.value)}>{Object.entries(authLabels).map(([id, name]) => <option value={id} key={id}>{tr(name)}</option>)}</Select></label>
          {form.authMode === 'auto' && <p className="form-note">{tr("使用本机 ~/.ssh/config、默认私钥和密钥代理。服务器已配置对应公钥时可免密登录；无需选择文件。")}</p>}
          {form.authMode === 'password' ? <div className="auth-note">{tr("连接时在本应用终端输入服务器密码或验证码。Harbor 不保存密码。")}</div> : <>
            <label>{tr("私钥 / PEM 文件 ")}<span className="optional">{form.authMode === 'auto' ? tr("可选，覆盖默认私钥") : tr("必填")}</span><div className="key-field"><input aria-label={tr("私钥 / PEM 文件")} placeholder={tr("~/.ssh/id_ed25519 或 AWS 下载的 .pem")} value={form.identityFile} onChange={e => set('identityFile', e.target.value)}/><button type="button" className="secondary" onClick={() => choose('identityFile')}>{tr("选择私钥")}</button></div></label>
            <p className="form-note">{tr("AWS 提供的 .pem 文件在此选择。私钥有口令时会在连接中询问；本机 .pub 公钥不能代替私钥登录。")}</p>
            {form.authMode === 'key-password' && <div className="auth-note">{tr("先尝试私钥，允许继续输入账户密码或验证码；是否要求追加认证由服务器决定。私钥本身的解密口令也受支持。")}</div>}
            <button type="button" className="certificate-toggle" onClick={() => setShowCertificate(!showCertificate)}>{showCertificate ? tr("收起 SSH 证书") : tr("+ 配置 SSH 证书（可选）")}</button>
            {showCertificate && <label>{tr("SSH 证书文件")}<div className="key-field"><input aria-label={tr("SSH 证书文件")} placeholder={tr("例如 ~/.ssh/id_ed25519-cert.pub")} value={form.certificateFile} onChange={e => set('certificateFile', e.target.value)}/><button type="button" className="secondary" onClick={() => choose('certificateFile', 'certificate')}>{tr("选择证书")}</button></div><small className="form-note">{tr("由 SSH CA 签发的证书，需搭配对应私钥；不是普通公钥文件。")}</small></label>}
          </>}
          <p className="form-note">{tr("密码、私钥口令和服务器指纹确认都在本应用内交互处理，不保存私钥内容。")}</p>
        </div>}
        {section === 'network' && <div role="tabpanel" id="server-network" aria-labelledby="server-tab-network">
          {form.transport === 'mosh' && <><div className="form-row"><label>{tr("UDP 端口")}<input aria-label={tr("Mosh UDP 端口")} type="number" min="1024" max="65535" value={form.moshPort} onChange={e => { const port = Number(e.target.value); setForm(prev => ({ ...prev, moshPort: port, moshPortEnd: prev.moshPortEnd === prev.moshPort ? port : prev.moshPortEnd })); }}/></label><label>{tr("结束端口")}<input aria-label={tr("Mosh UDP 结束端口")} type="number" min={form.moshPort} max={Math.min(65535, form.moshPort + 63)} value={form.moshPortEnd} onChange={e => set('moshPortEnd', Number(e.target.value))}/></label></div><p className="form-note">{tr("默认单端口 60042。每个并发 Mosh 连接独占一个端口，可配置最多 64 个。安装组件时可一并配置防火墙。")}</p>
            <label>{tr("预测回显")}<Select aria-label={tr("预测回显")} value={form.prediction} onChange={e => set('prediction', e.target.value)}><option value="adaptive">{tr("自适应 · 延迟高时预测")}</option><option value="always">{tr("始终启用")}</option><option value="never">{tr("关闭预测")}</option></Select></label>
            <p className="form-note">{capabilities?.mosh ? tr("本机 Mosh 已就绪。") : tr("可从右上角「可选组件」安装 Mosh。")}{tr("预测改善输入等待感，不加速远程命令；服务器仍需允许对应 UDP 通信。")}</p></>}
          <label>{form.transport === 'mosh' ? tr("SSH 初始认证策略") : tr("网络策略")}<Select aria-label={tr("网络策略")} value={form.networkProfile} onChange={e => set('networkProfile', e.target.value)}><option value="balanced">{tr("均衡 · 约 45 秒无响应后重连")}</option><option value="tolerant">{tr("弱网容错 · 容忍约 3 分钟短暂中断")}</option><option value="responsive">{tr("快速恢复 · 约 15 秒无响应后重连")}</option></Select></label>
          <div className="options"><label className="checkbox"><input type="checkbox" checked={form.persistent} onChange={e => set('persistent', e.target.checked)}/><div><strong>{tr("持久会话")}</strong><small>{tr("通过远程 tmux 保留任务，服务器需预先安装 tmux。")}</small></div></label><label className="checkbox"><input type="checkbox" disabled={form.transport === 'mosh'} checked={form.autoReconnect} onChange={e => set('autoReconnect', e.target.checked)}/><div><strong>{tr("断线自动重连")}</strong><small>{form.transport === 'mosh' ? tr("由 Mosh 自身恢复网络；进程退出后可手动重连。") : tr("SSH 异常退出后自动重试，最长间隔 30 秒。")}</small></div></label><label className="checkbox"><input type="checkbox" checked={form.compression} onChange={e => set('compression', e.target.checked)}/><div><strong>{tr("SSH 压缩")}</strong><small>{tr("适合低带宽文字输出，会增加 CPU 开销。")}</small></div></label></div>
        </div>}
      </div>
      {error && <div className="error" role="alert">{error}</div>}
      <div className="modal-footer">{server && <button type="button" className="danger" onClick={async () => { if (!confirmDelete) { setConfirmDelete(true); return; } try { await onDelete(server.id); } catch (e) { setError(e.message); } }}>{confirmDelete ? tr("确认删除配置") : tr("删除服务器")}</button>}<div className="spacer"/><button type="button" className="secondary" onClick={onClose}>{tr("取消")}</button><button type="submit" className="primary" disabled={saving}>{saving ? tr("保存中…") : tr("保存连接")}</button></div>
    </form>
  </div>;
}

function App() {
  useEffect(() => api?.onEdit(action => {
    const event = new CustomEvent('harbor-edit', { detail: action, cancelable: true });
    window.dispatchEvent(event);
    if (!event.defaultPrevented) api.editText(action).catch(() => {});
  }), []);
  useLanguage();
  const [servers, setServers] = useState([]);
  const [tabs, setTabs] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [query, setQuery] = useState('');
  const [dialog, setDialog] = useState(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [appearance, setAppearance] = useState(defaultAppearance);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [componentsOpen, setComponentsOpen] = useState(false);
  const [security, setSecurity] = useState(null);
  const [securityOpen, setSecurityOpen] = useState(false);
  const securityRef = useRef(null);
  async function applySecurity(next) {
    securityRef.current = next; setSecurity(next);
    if (next.locked) {
      setServers([]); setQuery(''); setDialog(null); setSecurityOpen(false); setComponentsOpen(false); setAppearanceOpen(false); setError('');
      setTabs(prev => prev.map(t => ({ ...t, title: tr("已锁定会话"), server: t.server ? { id: t.server.id } : null, installUsername: undefined })));
    } else {
      try {
        const [list, running] = await Promise.all([api.listServers(), api.listSessions()]);
        if (securityRef.current?.locked) return;
        setServers(list);
        setTabs(prev => prev.map(t => {
          const snapshot = running.find(s => s.id === t.id);
          return snapshot ? { ...t, server: snapshot.server, title: t.purpose ? tr("安装 Mosh · {0}", [snapshot.server?.name || tr("本机")]) : (snapshot.server?.name || tr("本地终端")) + (t.modeOverride === 'ssh' ? ' · SSH' : '') } : t;
        }));
      } catch (e) { if (!securityRef.current?.locked) setError(e.message); }
    }
  }
  useEffect(() => {
    if (!api) return;
    const off = api.onSecurity(applySecurity);
    api.getSecurity().then(applySecurity).catch(e => setError(e.message));
    let last = 0;
    const activity = () => { if (Date.now() - last > 1000) { last = Date.now(); api.activity(); } };
    window.addEventListener('pointerdown', activity); window.addEventListener('keydown', activity); window.addEventListener('wheel', activity, { passive: true });
    return () => { off(); window.removeEventListener('pointerdown', activity); window.removeEventListener('keydown', activity); window.removeEventListener('wheel', activity); };
  }, []);
  useEffect(() => { if (api) api.getAppearance().then(setAppearance).catch((e) => setError(e.message)); }, []);
  const active = tabs.find((t) => t.id === activeId);

  function openTab(server, modeOverride) {
    if (!securityRef.current || securityRef.current.locked) return;
    if (tabs.length >= 32) { setError(tr("最多可同时打开 32 个标签页。")); return; }
    const id = crypto.randomUUID();
    setTabs((prev) => [...prev, { id, title: (server?.name || tr("本地终端")) + (modeOverride === 'ssh' ? ' · SSH' : ''), server: modeOverride === 'ssh' ? { ...server, transport: 'ssh' } : server, modeOverride, state: 'starting' }]);
    setActiveId(id);
  }
  function installComponent(server, configureNetwork, installUsername) {
    if (tabs.length >= 32) throw new Error(tr("最多可同时打开 32 个标签页。"));
    const id = crypto.randomUUID();
    setTabs(prev => [...prev, { id, title: tr("安装 Mosh · {0}", [server?.name || tr("本机")]), server: server ? { ...server, username: installUsername || server.username, persistent: false, transport: 'ssh' } : null, installUsername, configureNetwork, purpose: server ? 'install-remote' : 'install-local', state: 'starting' }]);
    setActiveId(id);
    setComponentsOpen(false);
  }
  function closeTab(id) {
    setTabs((prev) => {
      const index = prev.findIndex((t) => t.id === id);
      const next = prev.filter((t) => t.id !== id);
      if (activeId === id) setActiveId(next[Math.min(index, next.length - 1)]?.id || null);
      return next;
    });
  }
  function onStatus(id, event) { setTabs((prev) => prev.map((t) => t.id === id ? { ...t, ...event } : t)); }
  useEffect(() => {
    const key = (e) => {
      if (!(isMac ? e.metaKey : e.ctrlKey && e.shiftKey) || dialog || appearanceOpen || componentsOpen || securityOpen || !security || security.locked) return;
      if (e.key.toLowerCase() === 't') { e.preventDefault(); openTab(); }
      if (e.key.toLowerCase() === 'w' && activeId) { e.preventDefault(); closeTab(activeId); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [tabs, activeId, dialog, appearanceOpen, componentsOpen, securityOpen, security]);
  if (!api) return <div className="browser-notice"><Icon name="terminal" size={36}/><h1>{tr("Harbor 是一个桌面终端")}</h1><p>{tr("请在项目目录运行 ")}<code>npm run dev</code>{tr(" 启动桌面版，以使用本地 Shell 和 SSH。")}</p></div>;
  return <><div className="app-shell" inert={!security || security.locked ? true : undefined} aria-hidden={!security || security.locked ? true : undefined}>
    <aside className="sidebar">
      <div className="drag-region"/>
      <div className="brand"><div className="brand-icon"><Icon name="terminal" size={23}/></div><div>Harbor<span>TERMINAL</span></div><span className="version">PREVIEW</span></div>
      <button className="local-button" onClick={() => openTab()}><Icon name="terminal"/><span>{tr("本地终端")}</span><kbd>{tabShortcut}</kbd></button>
      <div className="section-heading"><span>{tr("服务器")}</span><span className="count">{servers.length}</span><button className="icon-button" title={tr("添加服务器")} aria-label={tr("添加服务器")} onClick={() => setDialog({})}><Icon name="plus" size={17}/></button></div>
      <div className="search"><Icon name="search" size={15}/><input aria-label={tr("搜索服务器")} placeholder={tr("搜索连接…")} value={query} onChange={(e) => setQuery(e.target.value)}/></div>
      <div className="server-list">{servers.filter((s) => `${s.name} ${s.host} ${s.username}`.toLowerCase().includes(query.toLowerCase())).map((server) => <div className={`server-item ${active?.server?.id === server.id ? 'selected' : ''}`} key={server.id}><button className="server-open" onClick={() => openTab(server)} title={tr("连接 {0}", [server.name])}><div className="server-symbol"><Icon name="server" size={17}/></div><div className="server-text"><strong>{server.name}</strong><small>{server.username ? `${server.username}@` : ''}{server.host}</small></div><span className={`dot ${tabs.some((t) => t.server?.id === server.id && ['running', 'mosh'].includes(t.state)) ? 'green' : ''}`}/></button><button className="edit-server icon-button" aria-label={tr("编辑 {0}", [server.name])} onClick={async () => { try { const full = await api.getServer(server.id); if (!securityRef.current?.locked) setDialog({ server: full }); } catch (e) { setError(e.message); } }}><Icon name="edit" size={14}/></button></div>)}{servers.length === 0 && <div className="sidebar-empty">{tr("还没有服务器")}<br/><span>{tr("添加后，点击即可连接。")}</span></div>}{servers.length > 0 && !servers.some((s) => `${s.name} ${s.host} ${s.username}`.toLowerCase().includes(query.toLowerCase())) && <div className="sidebar-empty">{tr("没有匹配的连接")}</div>}</div>
      <button className="add-server" onClick={() => setDialog({})}><Icon name="plus" size={16}/>{tr("添加服务器")}</button>
      <div className="sidebar-footer"><Icon name="shield" size={18}/><div>{tr("连接，由你掌控")}<small>{tr("SSH / Mosh · 本地配置存储")}</small></div></div>
    </aside>
    <main className="workspace">
      <header className="topbar"><div className="breadcrumb">{tr("工作空间 ")}<span>/</span> <strong>{tabTitle(active)}</strong></div><div className="topbar-actions"><LanguageSwitch/><span className="workspace-label"><span className="dot green"/>{tr("本地工作空间")}</span><button className="appearance-button" onClick={() => setSecurityOpen(true)}><Icon name="shield" size={16}/>{tr("安全设置")}</button>{security?.enabled && <button className="appearance-button" onClick={() => api.lock().then(applySecurity).catch(e => setError(e.message))}>{tr("锁定")}</button>}<button className="appearance-button" onClick={() => setComponentsOpen(true)}>{tr("可选组件")}</button><button className="appearance-button" onClick={() => setAppearanceOpen(true)}><Icon name="palette" size={16}/>{tr("终端外观")}</button></div></header>
      <div className="tabbar"><div className="tabs" role="tablist">{tabs.map((tab) => <div className={`tab ${tab.id === activeId ? 'selected' : ''}`} key={tab.id}><button role="tab" aria-selected={tab.id === activeId} onClick={() => setActiveId(tab.id)}><Icon name={tab.server ? 'server' : 'terminal'} size={15}/><span>{tabTitle(tab)}</span><span className={`dot ${['running', 'mosh', 'local'].includes(tab.state) ? 'green' : tab.state === 'retrying' ? 'amber' : ''}`}/></button><button className="tab-close" aria-label={tr("关闭 {0}", [tabTitle(tab)])} onClick={() => closeTab(tab.id)}><Icon name="close" size={12}/></button></div>)}</div><button className="icon-button new-tab" aria-label={tr("新建本地终端")} title={tr("新建本地终端 {0}", [tabShortcut])} onClick={() => openTab()}><Icon name="plus" size={17}/></button></div>
      {error && <div className="error app-error" role="alert">{error}<button onClick={() => setError('')}>{tr("关闭")}</button></div>}
      {active && <div className="session-toolbar"><div><span className={`dot ${['running', 'mosh', 'local'].includes(active.state) ? 'green' : 'amber'}`}/><RecoveryStatus tab={active}/><span className="toolbar-divider"/>{active.server ? <code>{active.server.username ? `${active.server.username}@` : ''}{active.server.host}:{active.server.port}</code> : <code>login shell</code>}</div><div>{active.server?.transport === 'mosh' && <button className="reconnect" onClick={() => openTab(active.server, 'ssh')}>{tr("改用 SSH")}</button>}{active.server && <span className="network-badge" title={tr("运行状态不代表登录成功；Mosh 的网络状态请查看终端内提示")}>{active.server.transport === 'mosh' ? `Mosh · ${active.server.prediction === 'always' ? tr("始终预测") : active.server.prediction === 'never' ? tr("关闭预测") : tr("自适应预测")}` : tr(networkLabels[active.server.networkProfile || 'balanced'])}{active.server.compression ? tr(" · SSH 压缩") : ''}</span>}{active.state === 'retrying' && <button className="reconnect" onClick={() => api.pauseRetry(activeId).catch((e) => setError(e.message))}>{tr("暂停重连")}</button>}{active.server?.persistent && <span className="persist-badge"><Icon name="shield" size={13}/>{tr("tmux 持久会话")}</span>}{['exited', 'error', 'retrying', 'paused'].includes(active.state) && <button className="reconnect" onClick={() => api.reconnect(activeId).catch((e) => setError(e.message))}><Icon name="refresh" size={14}/>{tr("重新连接")}</button>}</div></div>}
      <div className="terminal-area">{tabs.map((tab) => tab.purpose ? <InstallationPane key={tab.id} api={api} tab={tab} active={tab.id === activeId} onStatus={onStatus}/> : <TerminalPane key={tab.id} tab={tab} active={tab.id === activeId} onStatus={onStatus} appearance={appearance}/>)}{!tabs.length && <div className="welcome"><div className="welcome-topline"><span className="small-line"/>{tr("你的下一段会话，从这里开始")}</div><div className="welcome-icon"><Icon name="terminal" size={38}/></div><h1>{tr("每一次连接，都能继续。")}</h1><p className="welcome-subtitle">{tr("本地开发，远程运维。")}<br/>{tr("把你的服务器与工作会话，放在同一个地方。")}</p><div className="welcome-actions"><button className="primary" onClick={() => setDialog({})}><Icon name="plus" size={17}/>{tr("添加第一台服务器")}<Icon name="arrow" size={16}/></button><button className="secondary" onClick={() => openTab()}><Icon name="terminal" size={17}/>{tr("打开本地终端")}</button></div><div className="feature-grid"><div><span className="feature-number">01</span><h3>{tr("一键进入工作状态")}</h3><p>{tr("保存 SSH 连接，点击名称")}<br/>{tr("即可在独立标签页中打开。")}</p></div><div><span className="feature-number">02</span><h3>{tr("断线，不中断进程")}</h3><p>{tr("自动重连搭配远程 tmux，")}<br/>{tr("网络恢复后接回原有会话。")}</p></div><div><span className="feature-number">03</span><h3>{tr("专注终端性能")}</h3><p>{tr("原生 PTY，批量传输输出，")}<br/>{tr("有界缓存与输出背压。")}</p></div></div><div className="tmux-tip"><Icon name="shield" size={16}/><span>{tr("启用持久会话前，请在远程服务器安装 ")}<code>tmux</code>{tr("。")}</span></div></div>}</div>
      <footer className="statusbar"><div><span className="dot green"/>Harbor <span className="status-separator">/</span> {tabs.length === 1 ? tr("1 个会话") : tr("{0} 个会话", [tabs.length])}</div><div>{active?.server?.persistent ? <><span>{tr("关闭标签页会分离 tmux；远程进程继续运行")}</span><span className="status-separator">·</span><button onClick={async () => { try { await api.copyText('tmux list-sessions'); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch (e) { setError(e.message); } }}>{copied ? tr("已复制命令") : tr("复制会话查看命令")}</button></> : <><span>UTF-8</span><span className="status-separator">·</span><span>xterm-256color</span></>}</div></footer>
    </main>
    {securityOpen && <SecurityDialog api={api} state={security} onClose={() => setSecurityOpen(false)} onChange={applySecurity}/> }
    {componentsOpen && <ComponentsDialog api={api} servers={servers} onClose={() => setComponentsOpen(false)} onInstall={installComponent}/>}
    {appearanceOpen && <AppearanceDialog value={appearance} onClose={() => setAppearanceOpen(false)} onSave={async (value) => { setAppearance(await api.saveAppearance(value)); setAppearanceOpen(false); }}/> }
    {dialog && <ServerDialog server={dialog.server} onClose={() => setDialog(null)} onSave={async (s) => { setServers(await api.saveServer(s)); setDialog(null); }} onDelete={async (id) => { setServers(await api.deleteServer(id)); setDialog(null); }}/ >}
  </div>{security?.locked && <LockScreen api={api} state={security} onChange={applySecurity}/>} {!security && <div className="lock-screen"><p>{error || tr("正在加载安全配置…")}</p></div>}</>;
}

initializeLanguage().catch(() => {}).finally(() => createRoot(document.getElementById('root')).render(<App/>));
