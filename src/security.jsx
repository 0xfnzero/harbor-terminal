import { LanguageSwitch } from './language.jsx';
import { t as tr, useLanguage } from './i18n.jsx';
import React, { useEffect, useRef, useState } from 'react';
import { Select } from './select.jsx';

function InputPrivacySettings({ api }) {
  const [value, setValue] = useState(null);
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { api.getInputPrivacy().then(setValue).catch(error => setNotice(error.message)); }, []);
  async function save() {
    setSaving(true); setNotice('');
    try { setValue(await api.saveInputPrivacy(value)); setNotice(tr('输入保护设置已保存')); }
    catch (error) { setNotice(error.message); }
    finally { setSaving(false); }
  }
  return <details className="input-privacy-settings"><summary>{tr('输入与剪贴板保护')}</summary>
    {value && <div>
      <label className="checkbox"><input type="checkbox" checked={value.secureKeyboard} disabled={!value.secureKeyboardSupported} onChange={event => setValue({ ...value, secureKeyboard: event.target.checked })}/><span><strong>{tr('安全键盘输入（macOS）')}</strong><small>{value.secureKeyboardSupported ? tr('仅在 Harbor 获得焦点时启用系统保护，离开窗口自动释放。可能影响全局快捷键或辅助功能。') : tr('当前系统没有此 macOS 保护能力。')}</small></span></label>
      <label className="privacy-timeout">{tr('自动清除 Harbor 复制的内容')}<Select aria-label={tr('自动清除 Harbor 复制的内容')} value={String(value.clipboardSeconds)} onChange={event => setValue({ ...value, clipboardSeconds: Number(event.target.value) })}><option value="30">{tr('30 秒')}</option><option value="60">{tr('60 秒 · 推荐')}</option><option value="120">{tr('2 分钟')}</option><option value="0">{tr('锁定或退出时清除')}</option></Select></label>
      <p className="form-note">{tr('普通模式会提示兼容的剪贴板管理器跳过历史记录，并仅清除仍属于 Harbor 的剪贴板内容。这些措施不能防御已经控制系统或进程的恶意软件。')}</p>
      <button type="button" className="secondary" disabled={saving} onClick={save}>{tr('保存输入保护设置')}</button>
    </div>}
    {notice && <p role="status" className="form-note">{notice}</p>}
  </details>;
}

export function SecurityDialog({ api, state, onClose, onChange }) {
  useLanguage();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [touchEnabled, setTouchEnabled] = useState(state.touchEnabled);
  const [idleMinutes, setIdleMinutes] = useState(state.idleMinutes);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const root = useRef(null);
  useEffect(() => { root.current?.focus(); }, []);
  async function save(e) {
    e.preventDefault(); setError('');
    const creating = !state.enabled;
    if ((creating || newPassword) && (creating ? password : newPassword) !== confirm) { setError(tr("两次输入的密码不一致")); return; }
    setBusy(true);
    try {
      const value = { password, newPassword, touchEnabled, idleMinutes: Number(idleMinutes) };
      onChange(await (creating ? api.enableSecurity(value) : api.configureSecurity(value)));
      setPassword(''); setNewPassword(''); setConfirm(''); onClose();
    } catch (e) { setError(e.message); setPassword(''); setConfirm(''); setNewPassword(''); }
    finally { setBusy(false); }
  }
  return <div className="modal-overlay"><form className="modal security-dialog" role="dialog" aria-modal="true" aria-labelledby="security-title" onSubmit={save} tabIndex={-1} ref={root} onKeyDown={e => { if (e.key === 'Escape' && !busy) onClose(); }}>
    <div className="modal-heading"><div><div className="eyebrow">{tr("隐私与安全")}</div><h2 id="security-title">{tr("安全与锁屏")}</h2></div><span className={`security-pill ${state.enabled ? 'enabled' : ''}`}>{state.enabled ? tr("加密保护已开启") : tr("尚未开启")}</span></div>
    <div className="security-intro">{state.enabled ? tr("服务器配置已加密保存。解锁一次即可继续使用，切换服务器无需重复验证。") : tr("开启后，服务器名称、地址、账号、密钥路径和连接设置将加密保存。重启应用后先解锁，再访问服务器。")}</div>
    <InputPrivacySettings api={api}/>
    <label>{state.enabled ? tr("当前应用锁屏密码") : tr("设置应用锁屏密码")}<input aria-label={state.enabled ? tr("当前应用锁屏密码") : tr("设置应用锁屏密码")} type="password" autoComplete={state.enabled ? 'current-password' : 'new-password'} required minLength={state.enabled ? undefined : 12} value={password} onChange={e => setPassword(e.target.value)} placeholder={state.enabled ? tr("修改安全设置需要验证") : tr("至少 12 个字符，建议使用长短语")}/></label>
    {state.enabled && <label>{tr("新应用锁屏密码 ")}<span className="optional">{tr("可选，留空保持原密码")}</span><input aria-label={tr("新应用锁屏密码")} type="password" autoComplete="new-password" minLength={12} value={newPassword} onChange={e => setNewPassword(e.target.value)}/></label>}
    {(!state.enabled || newPassword) && <label>{tr("确认应用锁屏密码")}<input aria-label={tr("确认应用锁屏密码")} type="password" autoComplete="new-password" required minLength={12} value={confirm} onChange={e => setConfirm(e.target.value)}/></label>}
    <label className="checkbox security-touch"><input type="checkbox" checked={touchEnabled} disabled={!state.touchAvailable && !state.touchEnabled} onChange={e => setTouchEnabled(e.target.checked)}/><span><strong>{tr("使用 Touch ID 快速解锁")}</strong><small>{state.touchAvailable ? tr("由 macOS 验证指纹；应用不读取或保存指纹。密码仍可作为备用解锁方式。") : tr("当前设备不支持或暂时无法使用 Touch ID，可使用应用锁屏密码。")}</small></span></label>
    <label>{tr("闲置后自动锁定")}<Select aria-label={tr("闲置后自动锁定")} value={String(idleMinutes)} onChange={e => setIdleMinutes(e.target.value)}><option value="5">{tr("5 分钟")}</option><option value="15">{tr("15 分钟")}</option><option value="30">{tr("30 分钟 · 推荐")}</option><option value="60">{tr("1 小时")}</option><option value="120">{tr("2 小时")}</option><option value="0">{tr("本次使用期间保持解锁")}</option></Select></label>
    <p className="form-note">{tr("电脑锁屏、休眠或退出应用时会重新锁定。锁定期间禁止新建连接，已有连接继续运行并可自动重连；需要密码或验证码时请先解锁。")}</p>
    <p className="form-note">{tr("这是独立的 Harbor 密码，不是电脑登录密码。请妥善保管；没有可用 Touch ID 且忘记密码时，无法恢复加密配置。外部 PEM / 私钥文件仍由原文件的口令和系统权限保护。")}</p>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="modal-footer"><button type="button" className="secondary" disabled={busy} onClick={onClose}>{tr("取消")}</button><span className="spacer"/><button className="primary" disabled={busy}>{busy ? tr("正在保护配置…") : state.enabled ? tr("保存安全设置") : tr("开启加密保护")}</button></div>
  </form></div>;
}

export function LockScreen({ api, state, onChange }) {
  useLanguage();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const input = useRef(null);
  useEffect(() => { input.current?.focus(); }, []);
  async function unlock(method) {
    setBusy(true); setError('');
    const value = password; setPassword('');
    try { onChange(await api.unlock({ method, password: method === 'password' ? value : undefined })); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  return <div className="lock-screen" role="dialog" aria-modal="true" aria-labelledby="lock-title"><div className="lock-language"><LanguageSwitch/></div><div className="lock-card">
    <div className="lock-emblem" aria-hidden="true">◇</div><div className="eyebrow">{tr("Harbor · 私密工作空间")}</div><h1 id="lock-title">{tr("工作空间已锁定")}</h1><p>{tr("解锁后继续你的连接。")}<br/>{tr("现有终端与远程任务保持运行。")}</p>
    {state.touchEnabled && state.touchAvailable && <button className="primary touch-unlock" disabled={busy} onClick={() => unlock('touch')}>{tr("使用 Touch ID 解锁")}</button>}
    <form onSubmit={e => { e.preventDefault(); unlock('password'); }}><label htmlFor="unlock-password">{tr("应用锁屏密码")}</label><input id="unlock-password" ref={input} type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required disabled={busy} placeholder={tr("输入 Harbor 密码")}/><button className="secondary" disabled={busy || !password}>{busy ? tr("正在解锁…") : tr("解锁工作空间")}</button></form>
    {error && <p className="error" role="alert">{error}</p>}<small>{tr("本次解锁会自动复用，无需逐个服务器验证。")}</small>
  </div></div>;
}
